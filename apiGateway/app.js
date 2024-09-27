require('dotenv').config();
const express = require('express');
const proxy = require('express-http-proxy');

const app = express();

const userServiceUrl = process.env.USER_SERVICE_URL;
const recommendationServiceUrl = process.env.RECOMMENDATION_SERVICE_URL;

if (!userServiceUrl || !recommendationServiceUrl) {
    throw new Error('USER_SERVICE_URL or RECOMMENDATION_SERVICE_URL is not defined');
}

app.use('/api/users', proxy(userServiceUrl, {
    proxyReqPathResolver: function (req) {
        return '/api/users' + req.url;
    }
}));

app.use('/api/posts/', proxy(recommendationServiceUrl, {
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.followRedirects = false;
        return proxyReqOpts;
    },
    skipToNextHandlerFilter: (proxyRes) => {
        return proxyRes.statusCode === 307;
    },
    proxyReqPathResolver: function (req) {
        return '/api/posts' + req.url;
    }
}));

app.use('/ws/posts/', proxy(recommendationServiceUrl, { ws: true }));


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API Gateway running on port ${PORT}`);
});
