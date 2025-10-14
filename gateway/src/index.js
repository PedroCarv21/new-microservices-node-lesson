import express from 'express';
import morgan from 'morgan';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();

app.use(morgan('dev'));

const PORT = process.env.PORT || 3000;
const USERS_URL = process.env.USERS_URL || 'http://localhost:3001';
const ORDERS_URL = process.env.ORDERS_URL || 'http://localhost:3002';

// Roteamento de APIs
app.use('/users', createProxyMiddleware({
  target: USERS_URL,
  changeOrigin: true,
  pathRewrite: {'^/users': ''},
  onProxyReq: (proxyReq, req, res) => {
    if (req.body){
        const bodyData = JSON.stringify(req.body);
     proxyReq.setHeader('Content-Type', 'application/json');
     proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
     proxyReq.write(bodyData)
    }
  }
}));

app.use('/orders', createProxyMiddleware({
  target: ORDERS_URL,
  changeOrigin: true,
  pathRewrite: {'^/orders': ''}
}));

app.use(express.json());

// Health
app.get('/health', (req, res) => res.json({ ok: true, service: 'gateway' }));

app.listen(PORT, () => {
  console.log(`[gateway] listening on http://localhost:${PORT}`);
  console.log(`[gateway] users -> ${USERS_URL}`);
  console.log(`[gateway] orders -> ${ORDERS_URL}`);
});
