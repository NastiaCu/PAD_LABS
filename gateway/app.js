const express = require('express');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const app = express();

let requestCount = 0;
const REQUEST_LIMIT = 5;
const requestWindow = 100;

setInterval(() => {
    console.log(`Checking load: ${requestCount} requests`);
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

const PROTO_PATH = './user.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {});
const userProto = grpc.loadPackageDefinition(packageDefinition).user;
const grpcClient = new userProto.UserService('user_service:50051', grpc.credentials.createInsecure());

const breaker = new CircuitBreaker(async (url) => {
    return await axios.get(url);
}, breakerOptions);

breaker.on('open', () => {
    console.log('Circuit breaker tripped! Too many failures (3 consecutive failures).');
});

const registerGatewayWithConsul = async () => {
    const CONSUL_HOST = process.env.CONSUL_HOST || 'consul';
    const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
    const CONSUL_URL = `http://${CONSUL_HOST}:${CONSUL_PORT}`;

    try {
        const registerUrl = `${CONSUL_URL}/v1/agent/service/register`;
        const serviceDefinition = {
            Name: 'gateway',
            ID: 'gateway',
            Address: 'gateway',
            Port: 3000,
            Tags: ['api-gateway'],
        };
        await axios.put(registerUrl, serviceDefinition);
        console.log('Gateway registered with Consul');
    } catch (error) {
        console.error('Failed to register gateway with Consul:', error.message);
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

app.use('/api/users', async (req, res) => {
    increaseRequestCount();
    grpcClient.GetUserStatus({ user_id: '1' }, (error, response) => {
        if (!error) {
            res.json({ status: response.status });
        } else {
            console.error('gRPC call failed:', error);
            res.status(500).json({ error: 'gRPC call failed' });
        }
    });
});

app.use('/api/posts', async (req, res, next) => {
    const CONSUL_HOST = process.env.CONSUL_HOST || 'consul';
    const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
    const CONSUL_URL = `http://${CONSUL_HOST}:${CONSUL_PORT}`;

    try {
        const servicesUrl = `${CONSUL_URL}/v1/agent/services`;
        const response = await axios.get(servicesUrl);
        const services = response.data;

        const instances = Object.values(services).filter(s => s.Service === 'recommendation-service');
        if (!instances.length) {
            return res.status(503).json({ error: 'Recommendation service unavailable' });
        }

        const postServiceUrl = `http://${instances[0].Address}:${instances[0].Port}${req.originalUrl}`;
        await retryRequest(postServiceUrl, 3);

        createProxyMiddleware({
            target: `http://${instances[0].Address}:${instances[0].Port}`,
            changeOrigin: true,
            pathRewrite: { '^/api/posts': '' },
        })(req, res, next);
    } catch (error) {
        console.error('Circuit breaker tripped: Service unavailable');
        res.status(500).json({ error: 'Service unavailable' });
    }
});

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
