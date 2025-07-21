// src/actions/index.ts

import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { stat } from 'fs';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
type RouteHandler = (event: any, id?: string) => Promise<any>;
const tableName = 'todoTable';

// Route handler map
const routeHandlers: Record<string, RouteHandler> = {
  'GET /items': async () => {
    const scanResult = await client.send(
      new ScanCommand({ TableName: tableName })
    );
    return scanResult.Items ?? [];
  },

  'GET /items/:id': async (_event, id) => {
    const getResult = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `TODO#${id}`,
          SK: `USER#${id}`,
        },
      })
    );
    return getResult.Item ?? {};
  },

  'POST /items': async (event) => {
    if (!event.body) throw new Error('Missing request body');

    const tableName = 'todoTable';
    const timestamp = new Date().toISOString();
    const inputData = JSON.parse(event.body);

    // Extract relevant fields
    const {
      priority,
      description,
      createdAt: ignore1,
      editedAt: ignore2,
      PK: ignore3,
      SK: ignore4,
      data,
      ...rest
    } = inputData;

    const generatedId = uuidv4();

    const newItem = {
      PK: `TODO#${generatedId}`,
      SK: `USER#${generatedId}`,
      priority: priority ?? 1,
      description: description ?? '',
      createdAt: timestamp,
      editedAt: timestamp,
      data: { ...rest, ...(data ?? {}) },
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: newItem,
      })
    );

    return {
      statusCode: 201,
      body: JSON.stringify({
        message: 'Created new item',
        generatedId,
        item: newItem,
      }),
    };
  },

  'PATCH /items/:id': async (event, id) => {
    if (!event.body) throw new Error('Missing request body');

    const tableName = 'todoTable';
    const timestamp = new Date().toISOString();
    const updateData = JSON.parse(event.body);

    // Step 1: Fetch existing item
    const existing = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `TODO#${id}`,
          SK: `USER#${id}`,
        },
      })
    );

    if (!existing.Item) {
      return {
        statusCode: StatusCodes.NOT_FOUND,
        body: JSON.stringify({
          message: `Not Found item ${id}`,
        }),
      };
    }

    const { PK, SK, createdAt } = existing.Item;

    // Step 2: Extract known and custom fields
    const {
      priority,
      description,
      editedAt,
      createdAt: ignore1,
      PK: ignore2,
      SK: ignore3,
      data,
      ...rest
    } = updateData;

    // Step 3: Build final updated item
    const updatedItem = {
      PK,
      SK,
      priority: priority ?? 1,
      description: description ?? '',
      createdAt,
      editedAt: timestamp,
      data: { ...rest, ...(data ?? {}) },
    };

    // Step 4: Put updated item back
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: updatedItem,
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Updated item ${id}`,
        updated: updatedItem,
      }),
    };
  },

  'DELETE /items/:id': async (_event, id) => {
    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: {
          PK: `TODO#${id}`,
          SK: `USER#${id}`,
        },
      })
    );
    return { message: `Deleted item ${id}`, id };
  },
};

// Pattern matcher
const matchRoute = (method: string, path: string) => {
  for (const key in routeHandlers) {
    const [routeMethod, routePath] = key.split(' ');
    if (routeMethod !== method) continue;

    const match = path.match(
      new RegExp(`^${routePath.replace(':id', '([^/]+)')}$`)
    );
    if (match) {
      const id = match[1];
      return { handler: routeHandlers[key], id };
    }
  }
  return null;
};

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let statusCode = StatusCodes.OK;
  let body: string | object = '';

  try {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    const matched = matchRoute(method, path);
    if (!matched) throw new Error(`Unsupported route: ${method} ${path}`);

    body = await matched.handler(event, matched.id);
  } catch (err) {
    statusCode = StatusCodes.BAD_REQUEST;
    body = (err as Error).message;
  }

  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
};
