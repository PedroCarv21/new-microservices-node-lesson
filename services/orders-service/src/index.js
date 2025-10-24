import express from 'express';
import morgan from 'morgan';
import fetch from 'node-fetch';
// import { nanoid } from 'nanoid';
import { createChannel } from './amqp.js';
import { ROUTING_KEYS } from '../common/events.js';
import { PrismaClient } from '@prisma/client';
import { retryWithBackoff } from './utils.js';

import swaggerUi from 'swagger-ui-express';

const app = express();
app.use(express.json());
app.use(morgan('dev'));

const prisma = new PrismaClient();

const PORT = process.env.PORT || 3002;
const USERS_BASE_URL = process.env.USERS_BASE_URL || 'http://users:3001';
const HTTP_TIMEOUT_MS = Number(process.env.HTTP_TIMEOUT_MS || 2000);
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE = process.env.EXCHANGE || 'app.topic';
const QUEUE = process.env.QUEUE || 'orders.q';
const ROUTING_KEY_USER_CREATED = process.env.ROUTING_KEY_USER_CREATED || ROUTING_KEYS.USER_CREATED;
const ROUTING_KEY_USER_UPDATED = process.env.ROUTING_KEY_USER_UPDATED || ROUTING_KEYS.USER_UPDATED;

// In-memory "DB"
// const orders = new Map();
// In-memory cache de usuários (preenchido por eventos)
const userCache = new Map();

let amqp = null;
(async () => {
  const setupAmqp = async () => { /* ... sua lógica setupAmqp ... */ 
    const amqpConn = await createChannel(RABBITMQ_URL, EXCHANGE);
    console.log('[orders] AMQP Conectado');
    await amqpConn.ch.assertQueue(QUEUE, { durable: true });
    await amqpConn.ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY_USER_CREATED);
    await amqpConn.ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY_USER_UPDATED);
    amqpConn.ch.consume(QUEUE, msg => {
      if (!msg) return;
      try {
        const data = JSON.parse(msg.content.toString());
        const key = msg.fields.routingKey;
        if (key === ROUTING_KEY_USER_CREATED) {
          userCache.set(data.id, data);
          console.log('[orders] consumed event user.created -> cached', data.id);
        } else if (key === ROUTING_KEY_USER_UPDATED) {
          userCache.set(data.id, data);
          console.log('[orders] consumed event user.updated -> cache updated', data.id);
        }
        amqpConn.ch.ack(msg);
      } catch (err) {
        console.error('[orders] consume error:', err.message);
        amqpConn.ch.nack(msg, false, false);
      }
    });
    return amqpConn;
  };
  try {
    amqp = await retryWithBackoff(setupAmqp, 5, 2000, 'Orders-AMQP-Setup');
  } catch (err) {
    console.error('[orders] Falha no setup do AMQP após todas as tentativas:', err.message);
  }
})();

const openapiSpecification = {
  openapi: '3.0.0',
  info: {
    title: 'Orders Service API',
    version: '1.0.0',
    description: 'API para gerenciar pedidos',
  },
  servers: [
    { url: `http://localhost:${PORT}`, description: 'Servidor Local' }
  ],
  components: {
    schemas: {
      // Schema para um item dentro do pedido
      OrderItem: {
        type: 'object',
        required: ['sku', 'qty'],
        properties: {
          sku: { type: 'string', description: 'Identificador do produto', example: 'BOOK-123' },
          qty: { type: 'integer', description: 'Quantidade do produto', example: 2 }
        }
      },
      // Schema completo de um pedido (como retornado pela API)
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID único do pedido (gerado pelo Prisma)', example: 'clxfa4zpq0000ghijk1234567' },
          userId: { type: 'string', description: 'ID do usuário que fez o pedido', example: 'clxfa4zpq0000abcde1234567' },
          items: { 
            type: 'array', 
            description: 'Lista de itens no pedido',
            items: { $ref: '#/components/schemas/OrderItem' } 
          },
          total: { type: 'number', format: 'float', description: 'Valor total do pedido', example: 120.50 },
          status: { type: 'string', description: 'Status atual do pedido', example: 'created' },
          createdAt: { type: 'string', format: 'date-time', description: 'Data e hora de criação do pedido' }
        }
      },
      // Schema para a entrada de criação de pedido
      OrderInput: {
        type: 'object',
        required: ['userId', 'items', 'total'],
        properties: {
          userId: { type: 'string', description: 'ID do usuário que está fazendo o pedido', example: 'clxfa4zpq0000abcde1234567' },
          items: {
            type: 'array',
            description: 'Lista de itens a serem pedidos',
            items: { $ref: '#/components/schemas/OrderItem' }
          },
          total: { type: 'number', format: 'float', description: 'Valor total calculado para o pedido', example: 120.50 }
        }
      },
      // Schema padrão para erros
      ErrorResponse: {
        type: 'object',
        properties: { error: { type: 'string' } }
      }
    }
  },
  // Definição das Rotas (Paths)
  paths: {
    // --- Rota /health ---
    '/health': {
      get: {
        summary: 'Verifica a saúde do serviço',
        tags: ['Health'],
        responses: {
          '200': { description: 'Serviço está operacional', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, service: { type: 'string' } } } } } }
        }
      }
    },
    // --- Rotas / ---
    '/': {
      // --- GET / ---
      get: {
        summary: 'Lista todos os pedidos',
        tags: ['Orders'],
        responses: {
          '200': { description: 'Uma lista de pedidos.', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } } } } },
          '500': { description: 'Erro interno do servidor.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      },
      // --- POST / ---
      post: {
        summary: 'Cria um novo pedido',
        tags: ['Orders'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderInput' } } }
        },
        responses: {
          '201': { description: 'Pedido criado com sucesso.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
          '400': { description: 'Dados inválidos (campos faltando ou usuário inválido).', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '503': { description: 'Serviço de usuários indisponível.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '500': { description: 'Erro interno do servidor.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    },
    // --- Rotas /{id} ---
    '/{id}': {
      // --- PATCH /{id} ---
      patch: {
        summary: 'Cancela um pedido existente',
        tags: ['Orders'],
        parameters: [
          { in: 'path', name: 'id', schema: { type: 'string' }, required: true, description: 'ID do pedido a ser cancelado' }
        ],
        responses: {
          '200': { description: 'Pedido cancelado com sucesso.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
          '404': { description: 'Pedido não encontrado.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '500': { description: 'Erro interno do servidor.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
        }
      }
    }
  }
};

app.get('/health', (req, res) => res.json({ ok: true, service: 'orders' }));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpecification));

app.get('/', async (req, res) => {
  try {
    const ordersFromDb = await prisma.order.findMany();

    const orders = ordersFromDb.map(order => ({
      ...order,
      items: JSON.parse(order.items)
    }));
    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Falha ao buscar pedidos' });
  }
});

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

app.post('/', async (req, res) => {
  const { userId, items, total } = req.body || {};
  if (!userId || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ error: 'userId, items[], total<number> são obrigatórios' });
  }

  // 1) Validação síncrona (HTTP) com RETRY
  try {
    
    // --- INÍCIO DA MODIFICAÇÃO ---

    // A. Definimos a função que o helper de retry irá executar
    const validateUserHttp = async () => {
      const resp = await fetchWithTimeout(`${USERS_BASE_URL}/${userId}`, HTTP_TIMEOUT_MS);
      
      // Só queremos tentar de novo em erros de rede/servidor (Timeout, 503, etc.)
      // Se for um erro 404 (usuário não encontrado), não adianta tentar de novo.
      // fetchWithTimeout já lança um erro (throw) em caso de timeout.
      if (!resp.ok && (resp.status === 503 || resp.status === 504 || resp.status === 502)) {
        // Força um erro para acionar o retry
        throw new Error(`Serviço de usuários indisponível (HTTP ${resp.status})`);
      }
      return resp; // Retorna a resposta (seja ela 200 OK ou 404 Not Found)
    };

    // B. Executamos a função com o retry
    // Tenta 3 vezes, com 500ms de espera inicial (500ms, 1s, 2s)
    const resp = await retryWithBackoff(validateUserHttp, 3, 500, 'Validate-User-HTTP');

    // C. Se o retry teve sucesso, checamos a resposta final
    if (!resp.ok) {
      // Se o serviço respondeu 404 (usuário não encontrado), tratamos como "usuário inválido"
      return res.status(400).json({ error: 'usuário inválido' });
    }
    
    // --- FIM DA MODIFICAÇÃO ---

  } catch (err) {
    // 2) SE TODAS AS TENTATIVAS DE RETRY FALHAREM, caímos aqui e usamos o "Plano B" (cache)
    console.warn('[orders] users-service timeout/failure (APÓS RETRIES), tentando cache...', err.message);
    if (!userCache.has(userId)) {
      return res.status(503).json({ error: 'users-service indisponível e usuário não encontrado no cache' });
    }
  }

  // 3) Se passou (pelo HTTP ou pelo cache), cria o pedido no Prisma
  try {
    const order = await prisma.order.create({
      data: {
        userId: userId,
        total: total,
        status: 'created',
        items: JSON.stringify(items)
      }
    });

    // ... (Publicação do evento order.created) ...

    res.status(201).json({
      ...order,
      items: JSON.parse(order.items)
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Falha ao criar pedido' });
  }
});

app.patch('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const order = await prisma.order.update({
      where: { id: id },
      data: {
        status: 'cancelled'
      }
    });

    // Publica o evento (não muda)
    try {
      if (amqp?.ch) {
        const payload = Buffer.from(JSON.stringify(order));
        amqp.ch.publish(EXCHANGE, ROUTING_KEYS.ORDER_CANCELLED, payload, { persistent: true });
        console.log('[orders] published event:', ROUTING_KEYS.ORDER_CANCELLED, order.id);
      }
    } catch (err) {
      console.error('[orders] publish error:', err.message);
    }
    
    // ATUALIZADO: Converte a string 'items' de volta para JSON para a resposta
    res.status(200).json({
      ...order,
      items: JSON.parse(order.items)
    });

  } catch (error) {
    if (error.code === 'P2025') { // 'Record to update not found'
      return res.status(404).json({ error: 'order not found' });
    }
    console.error(error);
    res.status(500).json({ error: 'Falha ao atualizar pedido' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[orders] listening on http://localhost:${PORT}`);
  console.log(`[orders] users base url: ${USERS_BASE_URL}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await prisma.$disconnect();
  server.close(() => {
    console.log('HTTP server closed');
  });
});