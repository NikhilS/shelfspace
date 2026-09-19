export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Shelf Library Unified REST Gateway API',
    version: '1.0.0',
    description:
      'High-performance REST API gateway for managing libraries, books, and AI enrichment, secured by Firebase Auth JWT and API keys.',
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API v1 Gateway',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Firebase ID Token',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Provisioned Library API Key',
      },
    },
    schemas: {
      Library: {
        type: 'object',
        properties: {
          id: {type: 'string'},
          name: {type: 'string'},
          ownerId: {type: 'string'},
          ownerName: {type: 'string'},
          access: {
            type: 'object',
            additionalProperties: {
              type: 'string',
              enum: ['owner', 'editor', 'viewer'],
            },
          },
          createdAt: {type: 'object'},
          heroImageUrl: {type: 'string'},
          bookCount: {type: 'number'},
          callerRole: {type: 'string', enum: ['owner', 'editor', 'viewer']},
        },
        required: ['id', 'name', 'ownerId', 'ownerName'],
      },
      Book: {
        type: 'object',
        properties: {
          id: {type: 'string'},
          libraryId: {type: 'string'},
          title: {type: 'string'},
          authors: {type: 'array', items: {type: 'string'}},
          publishedDate: {type: 'string'},
          pageCount: {type: 'number'},
          primaryGenre: {type: 'string'},
          subgenres: {type: 'array', items: {type: 'string'}},
          coverUrl: {type: 'string'},
          status: {
            type: 'string',
            enum: ['unset', 'reading', 'finished', 'abandoned'],
          },
          rating: {type: 'number'},
          temporalMetadata: {
            type: 'object',
            properties: {
              startYear: {type: 'number'},
              endYear: {type: 'number'},
              description: {type: 'string'},
            },
          },
          locationReferences: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {type: 'string'},
                adminLevel: {type: 'string'},
                rationale: {type: 'string'},
                coordinates: {
                  type: 'object',
                  properties: {
                    lat: {type: 'number'},
                    lng: {type: 'number'},
                  },
                },
              },
            },
          },
        },
        required: ['id', 'title'],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: {type: 'string'},
          details: {type: 'object'},
        },
        required: ['error'],
      },
    },
  },
  security: [{bearerAuth: []}, {apiKeyAuth: []}],
  paths: {
    '/libraries': {
      get: {
        summary: 'List user libraries',
        description:
          'Returns all libraries owned by or shared with the authenticated user.',
        tags: ['Libraries'],
        responses: {
          '200': {
            description: 'List of libraries',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {$ref: '#/components/schemas/Library'},
                },
              },
            },
          },
          '401': {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/ErrorResponse'},
              },
            },
          },
        },
      },
    },
    '/libraries/{libraryId}/books': {
      get: {
        summary: 'List books in library',
        description:
          'Returns paginated books from a library with optional missingMetadata filter.',
        tags: ['Books'],
        parameters: [
          {
            name: 'libraryId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
          {
            name: 'limit',
            in: 'query',
            schema: {type: 'integer', default: 50, maximum: 500},
          },
          {
            name: 'cursor',
            in: 'query',
            schema: {type: 'string'},
          },
          {
            name: 'missingMetadata',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['geo', 'temporal', 'genre', 'synopsis', 'coverImage'],
            },
          },
        ],
        responses: {
          '200': {
            description: 'Paginated list of books',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    books: {
                      type: 'array',
                      items: {$ref: '#/components/schemas/Book'},
                    },
                    nextCursor: {type: 'string'},
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a new book',
        description:
          'Creates a book in the specified library, partitioning heavy metadata.',
        tags: ['Books'],
        parameters: [
          {
            name: 'libraryId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: {type: 'string'},
                  authors: {type: 'array', items: {type: 'string'}},
                  primaryGenre: {type: 'string'},
                  subgenres: {type: 'array', items: {type: 'string'}},
                  synopsis: {type: 'string'},
                  isbn10: {type: 'string'},
                  isbn13: {type: 'string'},
                  coverUrl: {type: 'string'},
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created book record',
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/Book'},
              },
            },
          },
        },
      },
    },
    '/libraries/{libraryId}/books/{bookId}': {
      get: {
        summary: 'Get book details',
        description:
          'Fetches single book with its partitioned heavy metadata merged.',
        tags: ['Books'],
        parameters: [
          {
            name: 'libraryId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
          {
            name: 'bookId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
        ],
        responses: {
          '200': {
            description: 'Book details',
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/Book'},
              },
            },
          },
        },
      },
      patch: {
        summary: 'Update book',
        description:
          'Updates book fields and partitions heavy metadata updates.',
        tags: ['Books'],
        parameters: [
          {
            name: 'libraryId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
          {
            name: 'bookId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {type: 'object'},
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated book record',
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/Book'},
              },
            },
          },
        },
      },
      delete: {
        summary: 'Delete book',
        description:
          'Atomically deletes a book, its details, and decrements volume count.',
        tags: ['Books'],
        parameters: [
          {
            name: 'libraryId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
          {
            name: 'bookId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
        ],
        responses: {
          '200': {
            description: 'Deletion confirmation',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {type: 'boolean'},
                    bookId: {type: 'string'},
                  },
                },
              },
            },
          },
        },
      },
    },
    '/libraries/{libraryId}/books/batch': {
      post: {
        summary: 'Batch upsert books',
        description:
          'Atomically executes batch create, update, set, and delete operations.',
        tags: ['Books'],
        parameters: [
          {
            name: 'libraryId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  operations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['type', 'bookId'],
                      properties: {
                        type: {
                          type: 'string',
                          enum: ['create', 'update', 'delete', 'set'],
                        },
                        bookId: {type: 'string'},
                        data: {type: 'object'},
                        heavyData: {type: 'object'},
                        merge: {type: 'boolean'},
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Batch results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {type: 'boolean'},
                    processed: {type: 'number'},
                  },
                },
              },
            },
          },
        },
      },
    },
    '/libraries/{libraryId}/enrichment/trigger': {
      post: {
        summary: 'Trigger AI enrichment',
        description:
          'Dispatches asynchronous AI metadata enrichment for books in the library.',
        tags: ['Enrichment'],
        parameters: [
          {
            name: 'libraryId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  bookIds: {type: 'array', items: {type: 'string'}},
                  enrichmentTypes: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: ['geo', 'temporal', 'genre', 'synopsis'],
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Enrichment job result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: {type: 'boolean'},
                    totalQueued: {type: 'number'},
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
