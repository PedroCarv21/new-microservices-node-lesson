import express from 'express';
import morgan from 'morgan';
// Importamos o helper 'fixRequestBody'
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

// --- CONFIGURAÇÃO ---
const PORT = process.env.PORT || 3000;
const USERS_URL = process.env.USERS_URL || 'http://users:3001';
const ORDERS_URL = process.env.ORDERS_URL || 'http://orders:3002';

// --- APLICAÇÃO ---
const app = express();

app.use(morgan('dev'));
app.use(express.json()); // O parser de JSON deve vir antes do proxy

// --- OPÇÕES DO PROXY ---
const usersProxyOptions = {
  target: USERS_URL,
  changeOrigin: true,
  logLevel: 'debug',
  // ADICIONADO: Usamos o helper integrado para corrigir o corpo da requisição POST
  onProxyReq: fixRequestBody,
  onError: (err, req, res) => {
    console.error('[gateway] ERRO NO PROXY:', err);
    res.status(504).send('O Gateway não conseguiu se conectar ao serviço de destino.');
  },
};

const ordersProxyOptions = {
    target: ORDERS_URL,
    changeOrigin: true,
    logLevel: 'debug',
    onProxyReq: fixRequestBody,
};

// --- ROTAS ---
app.get('/health', (req, res) => res.json({ ok: true, service: 'gateway' }));

app.use('/users', createProxyMiddleware(usersProxyOptions));
app.use('/orders', createProxyMiddleware(ordersProxyOptions));


// --- INICIALIZAÇÃO DO SERVIDOR ---
app.listen(PORT, () => {
  console.log('----------------------------------------------------');
  console.log(`[gateway] Servidor rodando em http://localhost:${PORT}`);
  console.log(`[gateway] Proxy para /users -> ${USERS_URL}`);
  console.log(`[gateway] Proxy para /orders -> ${ORDERS_URL}`);
  console.log('----------------------------------------------------');
});