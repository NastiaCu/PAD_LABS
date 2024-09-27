const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const router = express.Router();

const userServiceProxy = createProxyMiddleware({
    target: process.env.USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: {
        '^/api/users': '', 
    }
});

router.use('/', userServiceProxy);

module.exports = router;
