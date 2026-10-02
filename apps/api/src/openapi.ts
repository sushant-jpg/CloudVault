export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'CloudVault API',
    version: '1.0.0',
    description: 'Security-first private file storage and controlled sharing API.'
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      ApiError: {
        type: 'object',
        required: ['success', 'error'],
        properties: { success: { const: false }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } } } }
      }
    }
  },
  paths: {
    '/auth/register': { post: { summary: 'Register an account', requestBody: { required: true }, responses: { '201': { description: 'Account registered' }, '422': { description: 'Validation failed' } } } },
    '/auth/login': { post: { summary: 'Authenticate and create a session', responses: { '200': { description: 'Authenticated' }, '401': { description: 'Invalid credentials or 2FA required' } } } },
    '/auth/refresh': { post: { summary: 'Rotate a refresh token', responses: { '200': { description: 'Token rotated' }, '401': { description: 'Invalid, expired, or reused token' } } } },
    '/files': { get: { summary: 'List authorized files', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Paginated files' } } } },
    '/files/upload': { post: { summary: 'Upload a private file into quarantine', security: [{ bearerAuth: [] }], requestBody: { content: { 'multipart/form-data': {} } }, responses: { '201': { description: 'Upload accepted' }, '413': { description: 'Quota or size exceeded' } } } },
    '/files/{id}/download': { post: { summary: 'Authorize download and issue a short-lived signed URL', security: [{ bearerAuth: [] }], parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Temporary download URL' }, '403': { description: 'Access denied' }, '423': { description: 'Security processing incomplete' } } } },
    '/shares': { post: { summary: 'Create a cryptographically random controlled share', security: [{ bearerAuth: [] }], responses: { '201': { description: 'Secure share created' } } } },
    '/shares/{token}/access': { post: { summary: 'Atomically consume secure share access', parameters: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Access granted' }, '401': { description: 'Password or authentication required' }, '410': { description: 'Expired, revoked, or exhausted' }, '429': { description: 'Rate limited' } } } },
    '/security/overview': { get: { summary: 'Security setup, sessions, events, and risk indicator', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Security overview' } } } }
  }
} as const;
