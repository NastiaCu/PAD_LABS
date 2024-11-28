require('dotenv').config();
const express = require('express');
const proxy = require('express-http-proxy');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { v4: uuidv4 } = require('uuid'); 
const client = require('prom-client');
const { Client } = require('pg');

const app = express();
app.use(express.json());

const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics(); 

const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route'],
  });


app.use((req, res, next) => {
    httpRequestsTotal.inc({ method: req.method, route: req.route?.path || 'unknown' });
    next();
  });

app.get('/metrics', async (req, res) => {
    try {
        const metrics = await client.register.metrics();  
        // console.log('Metrics collected:', metrics);

        res.set('Content-Type', client.register.contentType);
        res.send(metrics); 
    } catch (error) {
        console.error('Error while exposing metrics:', error);
        res.status(500).send('Internal Server Error');
    }
});

  
const userServiceUrl = process.env.USER_SERVICE_URL;
const recommendationServiceUrl = process.env.RECOMMENDATION_SERVICE_URL;
const sagaDbClient = new Client({
    connectionString: process.env.SAGA_DB_URL,
});

sagaDbClient.connect()
    .then(() => {
        console.log('Connected to saga database');
    })
    .catch(err => {
        console.error('Error connecting to saga database', err);
    });

async function createSagaTransaction(sagaId) {
    const query = 'INSERT INTO saga_transactions (saga_id, status) VALUES ($1, $2) RETURNING *';
    try {
        const res = await sagaDbClient.query(query, [sagaId, 'Started']);
        return res.rows[0];
    } catch (err) {
        console.error('Error creating saga transaction', err);
        throw err;
    }
}

async function updateSagaTransaction(sagaId, status) {
    const query = 'UPDATE saga_transactions SET status = $1 WHERE saga_id = $2 RETURNING *';
    try {
        const res = await sagaDbClient.query(query, [status, sagaId]);
        console.log(`Saga transaction updated: ${res.rows[0].status}`);
        return res.rows[0];
    } catch (err) {
        console.error('Error updating saga transaction', err);
        throw err;
    }
}

async function compensate(sagaId, userId, postId) {
    console.log(`Compensating for saga ${sagaId}...`);
    try {
        if (userId) {
            console.log(`Deleting user with ID ${userId}`);
            await axios.delete(`${process.env.USER_SERVICE_URL}/api/users/${userId}`);
        }

        if (postId) {
            console.log(`Deleting post with ID ${postId}`);
            await axios.delete(`${process.env.RECOMMENDATION_SERVICE_URL}/api/posts/${postId}`);
        }

        await updateSagaTransaction(sagaId, 'Failed');
    } catch (err) {
        console.error('Error during compensation:', err);
    }
}

app.post('/api/saga/create', async (req, res) => {
    const { userData, postData } = req.body;
    const sagaId = uuidv4();
    let userId = null;
    let postId = null;

    try {
        const saga = await createSagaTransaction(sagaId);

        const userResponse = await axios.post(`${process.env.USER_SERVICE_URL}/api/users/register`, userData);
        userId = userResponse.data.id;

        const postResponse = await axios.post(`${process.env.RECOMMENDATION_SERVICE_URL}/api/posts/`, postData);
        postId = postResponse.data.id;

        await updateSagaTransaction(sagaId, 'Completed');

        res.status(200).json({
            message: 'Saga completed successfully',
            sagaId,
            userId,
            postId,
        });
    } catch (error) {
        console.error('Saga creation failed:', error);

        await compensate(sagaId, userId, postId);
        res.status(500).json({ error: 'Saga failed, changes have been rolled back' });
    }
});

if (!userServiceUrl || !recommendationServiceUrl) {
    throw new Error('USER_SERVICE_URL or RECOMMENDATION_SERVICE_URL is not defined');
}

let requestCount = 0;
const REQUEST_LIMIT = 5;
const requestWindow = 100;

const MAX_RETRIES = 3;

setInterval(() => {
    //console.log(`Checking load: ${requestCount} requests`);
    if (requestCount > REQUEST_LIMIT) {
        console.log(`ALERT: High request load detected! (${requestCount} requests per second)`);
    }
    requestCount = 0;
}, requestWindow);

const increaseRequestCount = () => {
    requestCount += 1;
    console.log(`Request count increased: ${requestCount}`);
};

const breakerOptions = {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
};

const breaker = new CircuitBreaker(async (url) => {
    return await axios.get(url);
}, breakerOptions);

breaker.on('open', () => {
    console.log('Circuit breaker tripped! Too many failures (3 consecutive failures).');
});


let requestData = null;

breaker.on('failure', async (error) => {
    console.log(`Request failed: ${error.message}`);

    const failedServiceUrl = error.config ? error.config.url : 'Unknown URL';
    if (failedServiceUrl !== 'Unknown URL') {
        await deregisterFailedReplica('user-service', failedServiceUrl);
        console.log(`Failed service at ${failedServiceUrl} deregistered.`);
    }

    const healthyReplicas = await getActiveReplicas('user-service');

    if (healthyReplicas.length > 0) {
        const selectedReplica = healthyReplicas[0]; 
        console.log(`Rerouting to healthy replica: ${selectedReplica}`);

        if (requestData && requestUrl) {
            try {
                const reroutedUrl = `${selectedReplica}${requestUrl}`;
                console.log(`Rerouted request to: ${reroutedUrl}`);
                
                const response = await axios.post(reroutedUrl, requestData);
                console.log('Request successful to healthy replica:', response.data);
            } catch (err) {
                console.error('Failed to reroute to healthy replica:', err);
            }
        } else {
            console.error('No request data found to reroute.');
        }
    } else {
        console.error('No healthy replicas found. Service unavailable.');
    }
});


const PROTO_PATH = './user.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {});
const userProto = grpc.loadPackageDefinition(packageDefinition).user;
const grpcClient = new userProto.UserService('user_service:50051', grpc.credentials.createInsecure());

const registerGatewayWithConsul = async () => {
    const CONSUL_HOST = process.env.CONSUL_HOST || 'consul';
    const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
    const CONSUL_URL = `http://${CONSUL_HOST}:${CONSUL_PORT}`;
    const instanceId = "gateway";

    try {
        const registerUrl = `${CONSUL_URL}/v1/agent/service/register`;
        const serviceDefinition = {
            Name: 'gateway',
            ID: instanceId,
            Address: 'gateway',
            Port: 3000,
            Tags: ['api-gateway'],
        };
        await axios.put(registerUrl, serviceDefinition);
        console.log('Gateway registered with Consul as ${instanceId}');
    } catch (error) {
        console.error('Failed to register gateway with Consul:', error.message);
    }
};

const getActiveReplicas = async (serviceName) => {
    const CONSUL_HOST = process.env.CONSUL_HOST || 'consul';
    const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
    const CONSUL_URL = `http://${CONSUL_HOST}:${CONSUL_PORT}/v1/health/service/${serviceName}`;
    
    try {
        const response = await axios.get(CONSUL_URL);
        const healthyReplicas = response.data
            .filter(entry => entry.Checks.every(check => check.Status === 'passing'))
            .map(entry => `http://${entry.Service.Address}:${entry.Service.Port}`);

        return healthyReplicas.slice(0, 3);
    } catch (error) {
        console.error(`Failed to fetch replicas for ${serviceName} from Consul:`, error.message);
        return [];
    }
};

const sendRequestWithRetries = async (serviceName, endpoint, requestData) => {
    const replicas = await getActiveReplicas(serviceName); 
    for (let replica of replicas) {
        let retries = 0;
        const url = `${replica}${endpoint}`;

        while (retries < MAX_RETRIES) {
            try {
                const response = await breaker.fire(() => axios.post(url, requestData));
                return response.data;
            } catch (error) {
                retries += 1;
                console.log(`Retry ${retries} for ${url} failed. Retrying...`);
            }
        }

        await deregisterFailedReplica(serviceName, replica);
    }

    throw new Error("Service unavailable after all replicas failed.");
};

const deregisterFailedReplica = async (serviceName, replicaUrl) => {
    const CONSUL_HOST = process.env.CONSUL_HOST || 'consul';
    const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
    const CONSUL_SERVICES_URL = `http://${CONSUL_HOST}:${CONSUL_PORT}/v1/agent/services`;

    try {
        const response = await axios.get(CONSUL_SERVICES_URL);
        const services = response.data;

        const url = new URL(replicaUrl);
        const replicaAddress = url.hostname;
        const replicaPort = parseInt(url.port, 10);

        const serviceId = Object.keys(services).find(id => {
            const service = services[id];
            return (
                service.Service === serviceName &&
                service.Address === replicaAddress &&
                service.Port === replicaPort
            );
        });

        if (serviceId) {
            const CONSUL_DEREGISTER_URL = `http://${CONSUL_HOST}:${CONSUL_PORT}/v1/agent/service/deregister/${serviceId}`;
            await axios.put(CONSUL_DEREGISTER_URL);
            console.log(`Successfully deregistered replica with ID ${serviceId}`);
        } else {
            console.error(`Failed to find service ID for replica ${replicaUrl} to deregister.`);
        }
    } catch (error) {
        console.error(`Error deregistering replica:`, error.message);
    }
};

const retryRequest = async (url, retries) => {
    let attempt = 0;
    while (attempt < retries) {
        try {
            const response = await breaker.fire(url);
            console.log(`Request attempt ${attempt + 1} succeeded for service: ${url}`);
            return response;
        } catch (error) {
            console.error(`Attempt ${attempt + 1} failed for service: ${url}`);
            attempt += 1;
        }
    }
    throw new Error('Service unavailable after retries');
};

// app.use('/api/users', proxy(userServiceUrl, {
//     proxyReqPathResolver: function (req) {
//         return '/api/users' + req.url;  
//     }
// }));

let requestUrl = null;

app.use('/api/users', async (req, res) => {
    const endpoint = req.url;  
    const requestData = req.body; 
    requestUrl = req.originalUrl;

    try {
        const responseData = await sendRequestWithRetries('user-service', endpoint, requestData);
        res.json(responseData); 
    } catch (error) {
        console.error("Service unavailable after all retries.");
        res.status(500).json({ error: "Service unavailable after multiple attempts. Please try again later." });
    }
});

app.use('/api/posts', proxy(recommendationServiceUrl, {
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.followRedirects = false;
        return proxyReqOpts;
    },
    skipToNextHandlerFilter: (proxyRes) => {
        return proxyRes.statusCode === 307;
    },
    proxyReqPathResolver: function (req) {
        if (req.method === 'GET' && req.url === '/') {
            return '/api/posts';
        }
        return '/api/posts' + req.url;
    }
}));

app.use(
    '/ws/api/comments',
    createProxyMiddleware({
        target: process.env.RECOMMENDATION_SERVICE_URL,
        changeOrigin: true,
        ws: true,
        pathRewrite: { '^/ws/api/comments': '/ws/api/comments' }
    })
);

app.get('/status', async (req, res) => {
    const CONSUL_HOST = process.env.CONSUL_HOST || 'consul';
    const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
    const CONSUL_URL = `http://${CONSUL_HOST}:${CONSUL_PORT}`;

    try {
        const servicesUrl = `${CONSUL_URL}/v1/agent/services`;
        const response = await axios.get(servicesUrl);
        const services = response.data;

        res.json({
            status: 'Gateway is running',
            services: Object.keys(services),
        });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching services from Consul', details: error.message });
    }
});

registerGatewayWithConsul();

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`API Gateway running on port ${PORT}`);
});
