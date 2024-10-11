const express = require('express');
const axios = require('axios');
const { createProxyMiddleware } = require('http-proxy-middleware');
const CircuitBreaker = require('opossum');

const app = express();

const CONSUL_HOST = process.env.CONSUL_HOST || 'consul';
const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
const CONSUL_URL = `http://${CONSUL_HOST}:${CONSUL_PORT}`;

const GATEWAY_SERVICE = {
    name: 'gateway',
    address: 'gateway',
    port: 3000,
    tags: ['api-gateway']
};

const breakerOptions = {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    rollingCountTimeout: 10000,
    rollingCountBuckets: 10,
};

const retryLimit = 3;

const breaker = new CircuitBreaker(async (url) => {
    return await axios.get(url);
}, breakerOptions);

breaker.on('open', () => {
    console.log('Circuit breaker tripped! Too many failures (3 consecutive failures).');
});

const registerGatewayWithConsul = async () => {
    try {
        const registerUrl = `${CONSUL_URL}/v1/agent/service/register`;
        const serviceDefinition = {
            Name: GATEWAY_SERVICE.name,
            ID: GATEWAY_SERVICE.name,
            Address: GATEWAY_SERVICE.address,
            Port: GATEWAY_SERVICE.port,
            Tags: GATEWAY_SERVICE.tags,
        };
        await axios.put(registerUrl, serviceDefinition);
        console.log('Gateway registered with Consul');
    } catch (error) {
        console.error('Failed to register gateway with Consul:', error.message);
    }
};

const getServiceInstances = async (serviceName) => {
    try {
        const servicesUrl = `${CONSUL_URL}/v1/agent/services`;
        const response = await axios.get(servicesUrl);
        const services = response.data;
        return Object.values(services).filter(s => s.Service === serviceName);
    } catch (error) {
        console.error('Error fetching services from Consul:', error.message);
        return [];
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
    throw new Error('Service unavailable after 3 retries');
};

app.use('/api/users', async (req, res, next) => {
    const instances = await getServiceInstances('user-service');
    if (!instances.length) {
        return res.status(503).json({ error: 'User service unavailable' });
    }

    const userServiceUrl = `http://${instances[0].Address}:${instances[0].Port}${req.originalUrl}`;

    try {
        await retryRequest(userServiceUrl, retryLimit);
        createProxyMiddleware({
            target: `http://${instances[0].Address}:${instances[0].Port}`,
            changeOrigin: true,
            pathRewrite: { '^/api/users': '' },
        })(req, res, next);
    } catch (error) {
        console.error('Circuit breaker tripped: Service unavailable');
        res.status(500).json({ error: 'Service unavailable' });
    }
});

app.use('/api/posts', async (req, res, next) => {
    const instances = await getServiceInstances('recommendation-service');
    if (!instances.length) {
        return res.status(503).json({ error: 'Recommendation service unavailable' });
    }

    const postServiceUrl = `http://${instances[0].Address}:${instances[0].Port}${req.originalUrl}`;

    try {
        await retryRequest(postServiceUrl, retryLimit);
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
    try {
        const servicesUrl = `${CONSUL_URL}/v1/agent/services`;
        const response = await axios.get(servicesUrl);
        const services = response.data;
        res.json({ status: 'Gateway is running', services: Object.keys(services) });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching services from Consul', details: error.message });
    }
});

registerGatewayWithConsul();

const PORT = GATEWAY_SERVICE.port || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`API Gateway running on port ${PORT}`);
});
