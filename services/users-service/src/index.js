import express from 'express';
import morgan from 'morgan';
// import { nanoid } from 'nanoid';
import { createChannel } from './amqp.js';
import { ROUTING_KEYS } from '../common/events.js';
import { PrismaClient } from '@prisma/client';

const app = express();
app.use(express.json());
app.use(morgan('dev'));

const prisma = new PrismaClient();

const PORT = process.env.PORT || 3001;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const EXCHANGE = process.env.EXCHANGE || 'app.topic';

// In-memory "DB"
// const users = new Map();

let amqp = null;
(async () => {
  try {
    amqp = await createChannel(RABBITMQ_URL, EXCHANGE);
    console.log('[users] AMQP connected');
  } catch (err) {
    console.error('[users] AMQP connection failed:', err.message);
  }
})();

app.get('/health', (req, res) => res.json({ ok: true, service: 'users' }));

app.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Falha ao buscar usuários' });
  }
});

app.post('/', async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

  try {
    const user = await prisma.user.create({
      data: {
        name: name,
        email: email,
        // O ID e createdAt são gerados automaticamente pelo Prisma
      }
    });

    res.status(201).json(user); // Responde imediatamente

    // Publica o evento em segundo plano
    try {
      if (amqp?.ch) {
        const payload = Buffer.from(JSON.stringify(user));
        amqp.ch.publish(EXCHANGE, ROUTING_KEYS.USER_CREATED, payload, { persistent: true });
        console.log('[users] published event:', ROUTING_KEYS.USER_CREATED, user);
      }
    } catch (err) {
      console.error('[users] publish error:', err.message);
    }

  } catch (error) {
    // Adiciona tratamento de erro (ex: email duplicado)
    if (error.code === 'P2002') { // Código de erro do Prisma para 'unique constraint violation'
      return res.status(400).json({ error: 'Email já cadastrado' });
    }
    console.error(error);
    res.status(500).json({ error: 'Falha ao criar usuário' });
  }
});

app.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body;

  try {
    const user = await prisma.user.update({
      where: { id: id },
      data: {
        name: name, // O Prisma ignora campos undefined
        email: email
      }
    });

    // Publica o evento 'user.updated'
    try {
      if (amqp?.ch) {
        const payload = Buffer.from(JSON.stringify(user));
        amqp.ch.publish(EXCHANGE, ROUTING_KEYS.USER_UPDATED, payload, { persistent: true });
        console.log('[users] published event:', ROUTING_KEYS.USER_UPDATED, user);
      }
    } catch (err) {
      console.error('[users] publish error:', err.message);
    }
    
    res.status(200).json(user);

  } catch (error) {
    if (error.code === 'P2025') { // 'Record to update not found'
      return res.status(404).json({ error: 'user not found' });
    }
    console.error(error);
    res.status(500).json({ error: 'Falha ao atualizar usuário' });
  }
});

app.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const user = await prisma.user.findUnique({
      where: { id: id }
    });
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Falha ao buscar usuário' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[users] listening on http://localhost:${PORT}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await prisma.$disconnect();
  server.close(() => {
    console.log('HTTP server closed');
  });
});