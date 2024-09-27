const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const router = express.Router();

const recommendationServiceProxy = createProxyMiddleware({
    target: process.env.RECOMMENDATION_SERVICE_URL, 
    changeOrigin: true,
    pathRewrite: {
        '^/api/posts/': '', 
    },
    ws: true 
});

router.use('/', recommendationServiceProxy);

module.exports = router;
