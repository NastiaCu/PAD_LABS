const express = require('express');
const axios = require('axios');
const { createProxyMiddleware } = require('http-proxy-middleware');

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

const registerGatewayWithConsul = async () => {
    try {
        const registerUrl = `${CONSUL_URL}/v1/agent/service/register`;
        const serviceDefinition = {
            Name: GATEWAY_SERVICE.name,
            ID: GATEWAY_SERVICE.name,
            Address: GATEWAY_SERVICE.address,
            Port: GATEWAY_SERVICE.port,
            Tags: GATEWAY_SERVICE.tags
        };
        await axios.put(registerUrl, serviceDefinition);
        console.log('Gateway registered with Consul');
    } catch (error) {
        console.error('Failed to register gateway with Consul:', error.message);
    }
};

const getServiceUrl = async (serviceName) => {
    try {
        const servicesUrl = `${CONSUL_URL}/v1/agent/services`;
        const response = await axios.get(servicesUrl);
        const services = response.data;

        if (!services || Object.keys(services).length === 0) {
            console.error('No services found from Consul');
            return null;
        }

        const service = Object.values(services).find(s => s.Service === serviceName);
        if (service) {
            const serviceAddress = service.Address === 'localhost' ? '127.0.0.1' : service.Address;
            return `http://${serviceAddress}:${service.Port}`;
        } else {
            console.error(`Service ${serviceName} not found`);
            return null;
        }
    } catch (error) {
        console.error('Error fetching services from Consul:', error.message);
        return null;
    }
};

app.use('/api/users', async (req, res, next) => {
    const userServiceUrl = await getServiceUrl('user-service');
    if (!userServiceUrl) {
        return res.status(503).json({ error: 'User service unavailable' });
    }
    createProxyMiddleware({
        target: userServiceUrl,
        changeOrigin: true,
        pathRewrite: { '^/api/users': '' },
    })(req, res, next);
});

app.use('/api/posts', async (req, res, next) => {
    try {
        const postServiceUrl = 'http://recommendation_service:8000';

        console.log(`Proxying to recommendation_service: ${postServiceUrl}`);

        createProxyMiddleware({
            target: postServiceUrl,
            changeOrigin: true,
            pathRewrite: {
                '^/api/posts': '',
            },
        })(req, res, next);
    } catch (err) {
        console.error('Error in proxy middleware for recommendation-service:', err);
        res.status(500).send('Internal server error');
    }
});




app.get('/status', async (req, res) => {
    try {
        const servicesUrl = `${CONSUL_URL}/v1/agent/services`;
        const response = await axios.get(servicesUrl);
        const services = response.data;

        res.json({
            status: 'Gateway is running',
            services: Object.keys(services)
        });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching services from Consul', details: error.message });
    }
});

registerGatewayWithConsul();

const PORT = GATEWAY_SERVICE.port || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`API Gateway running on port ${PORT}`);
});
