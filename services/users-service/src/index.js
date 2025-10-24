import express from 'express';
import morgan from 'morgan';

// import { nanoid } from 'nanoid';
import { createChannel } from './amqp.js';
import { ROUTING_KEYS } from '../common/events.js';
import { PrismaClient } from '@prisma/client';
import { retryWithBackoff } from './utils.js';

// import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

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
    // 2. Defina a função que o retry deve executar
    const connectToAmqp = () => createChannel(RABBITMQ_URL, EXCHANGE);

    // 3. Execute a conexão com o retry
    amqp = await retryWithBackoff(connectToAmqp, 5, 2000, 'Users-AMQP-Connection');

    // O console.log de sucesso já está no helper, mas podemos adicionar um aqui se quisermos.
    // console.log('[users] AMQP connected');
  } catch (err) {
    console.error('[users] Falha ao conectar ao AMQP após todas as tentativas:', err.message);
    // Em um sistema real, poderíamos parar o serviço se o AMQP for vital
    // process.exit(1); 
  }
})();

const openapiSpecification = {
  openapi: '3.0.0',
  info: {
    title: 'Users Service API',
    version: '1.0.0',
    description: 'API para gerenciar usuários',
  },
  servers: [
    { url: `http://localhost:${PORT}`, description: 'Servidor Local' }
  ],
  // Schemas reutilizáveis (já estavam corretos)
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID único do usuário (gerado pelo Prisma)', example: 'clxfa4zpq0000abcde1234567' },
          name: { type: 'string', description: 'Nome do usuário', example: 'Bruno Nascimento' },
          email: { type: 'string', format: 'email', description: 'Endereço de e-mail único do usuário', example: 'bruno@example.com' },
          createdAt: { type: 'string', format: 'date-time', description: 'Data e hora de criação do usuário' },
        },
      },
      UserInput: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
          name: { type: 'string', description: 'Nome do usuário', example: 'Bruno Nascimento' },
          email: { type: 'string', format: 'email', description: 'Endereço de e-mail único do usuário', example: 'bruno@example.com' },
        },
      },
      UserUpdateInput: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Novo nome do usuário (opcional)', example: 'Bruno Lima' },
          email: { type: 'string', format: 'email', description: 'Novo e-mail do usuário (opcional)', example: 'bruno.lima@example.com' },
        },
      },
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
          '200': {
            description: 'Serviço está operacional',
            content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean', example: true }, service: { type: 'string', example: 'users' } } } } }
          }
        }
      }
    },
    // --- Rotas / ---
    '/': {
      // --- GET / ---
      get: {
        summary: 'Lista todos os usuários',
        tags: ['Users'],
        responses: {
          '200': {
            description: 'Uma lista de usuários.',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } }
          },
          '500': {
            description: 'Erro interno do servidor.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      },
      // --- POST / ---
      post: {
        summary: 'Cria um novo usuário',
        tags: ['Users'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UserInput' } } }
        },
        responses: {
          '201': {
            description: 'Usuário criado com sucesso.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
          },
          '400': {
            description: 'Dados inválidos (campos faltando ou email duplicado).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          },
          '500': {
            description: 'Erro interno do servidor.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      }
    },
    // --- Rotas /{id} ---
    '/{id}': {
      // --- GET /{id} ---
      get: {
        summary: 'Busca um usuário pelo seu ID',
        tags: ['Users'],
        parameters: [
          { in: 'path', name: 'id', schema: { type: 'string' }, required: true, description: 'ID do usuário a ser buscado' }
        ],
        responses: {
          '200': {
            description: 'Detalhes do usuário.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
          },
          '404': {
            description: 'Usuário não encontrado.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          },
          '500': {
            description: 'Erro interno do servidor.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      },
      // --- PATCH /{id} ---
      patch: {
        summary: 'Atualiza parcialmente um usuário existente',
        tags: ['Users'],
        parameters: [
          { in: 'path', name: 'id', schema: { type: 'string' }, required: true, description: 'ID do usuário a ser atualizado' }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UserUpdateInput' } } }
        },
        responses: {
          '200': {
            description: 'Usuário atualizado com sucesso.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
          },
          '404': {
            description: 'Usuário não encontrado.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          },
          '500': {
            description: 'Erro interno do servidor.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
          }
        }
      }
    }
  }
};

// Gera a especificação OpenAPI
// const openapiSpecification = swaggerJsdoc(swaggerOptions);

// console.log("--- OpenAPI Specification Gerada ---", JSON.stringify(openapiSpecification, null, 2));

app.get('/health', (req, res) => res.json({ ok: true, service: 'users' }));

// --- ROTA PARA SERVIR A DOCUMENTAÇÃO SWAGGER ---
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpecification));


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