require('dotenv').config();
const express = require('express');
const proxy = require('express-http-proxy');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { createProxyMiddleware } = require('http-proxy-middleware');


const app = express();
app.use(express.json());

const userServiceUrl = process.env.USER_SERVICE_URL;
const recommendationServiceUrl = process.env.RECOMMENDATION_SERVICE_URL;

if (!userServiceUrl || !recommendationServiceUrl) {
    throw new Error('USER_SERVICE_URL or RECOMMENDATION_SERVICE_URL is not defined');
}

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

const breaker = new CircuitBreaker(async (url) => {
    return await axios.get(url);
}, breakerOptions);

breaker.on('open', () => {
    console.log('Circuit breaker tripped! Too many failures (3 consecutive failures).');
});

const PROTO_PATH = './user.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {});
const userProto = grpc.loadPackageDefinition(packageDefinition).user;
const grpcClient = new userProto.UserService('user_service:50051', grpc.credentials.createInsecure());

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

app.use('/api/users', proxy(userServiceUrl, {
    proxyReqPathResolver: function (req) {
        return '/api/users' + req.url;  
    }
}));

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
