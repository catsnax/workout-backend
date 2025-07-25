// src/actions/index.ts

import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { StatusCodes, getReasonPhrase } from "http-status-codes";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { stat } from "fs";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
type RouteHandler = (event: any, id?: string) => Promise<any>;
const tableName = "workoutTable";

// Route handler map
const routeHandlers: Record<string, RouteHandler> = {
  "GET /users": async () => {
    const scanResult = await client.send(
      new ScanCommand({ TableName: tableName })
    );
    return scanResult.Items ?? [];
  },
  "POST /users": async (event) => {
    if (!event.body) throw new Error("Missing request body");
    const tableName = "workoutTable";
    const timestamp = new Date().toISOString();
    const inputData = JSON.parse(event.body);

    const {
      username,
      password,
      emailAddress,
      createdAt: ignore1,
      PK: ignore2,
      SK: ignore3,
      ...rest
    } = inputData;

    const newUser = {
      PK: `USER#${username}`,
      SK: `USER#${username}`,
      emailAddress: emailAddress,
      createdAt: timestamp,
      password: await bcrypt.hashSync(password, 10),
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: newUser,
      })
    );
    return {
      statusCode: 201,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: JSON.stringify({
        message: "Created new user",
        item: newUser,
      }),
    };
  },

  "POST /login": async (event) => {
    if (!event.body) throw new Error("Missing request body");
    const tableName = "workoutTable";
    const inputData = JSON.parse(event.body);

    const { username, password } = inputData;

    const { Item } = await client.send(
      new GetItemCommand({
        TableName: tableName,
        Key: {
          PK: { S: `USER#${username}` },
          SK: { S: `USER#${username}` },
        },
      })
    );

    if (!Item) {
      return {
        statusCode: StatusCodes.NOT_FOUND,
        body: JSON.stringify({ message: "User not found" }),
      };
    }

    const storedHash = Item?.password?.S;

    if (!storedHash) {
      throw new Error("Password hash is missing");
    }

    const isMatch = await bcrypt.compare(password, storedHash);

    if (!isMatch) {
      return {
        statusCode: StatusCodes.UNAUTHORIZED,
        body: JSON.stringify({ message: "Invalid credentials" }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Set-Cookie": `PK=USER#${username}; HttpOnly; SameSite=None; Path=/`,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: JSON.stringify({
        message: "Login successful",
        PK: Item.PK.S,
      }),
    };
  },

  "GET /workouts": async (event) => {
    const pk = event.queryStringParameters?.pk;

    if (!pk) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing 'pk' query parameter" }),
      };
    }

    const getResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": { S: pk },
          ":skPrefix": { S: "WORKOUT#" },
        },
      })
    );

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(getResult.Items ?? []),
    };
  },

  "POST /workouts": async (event) => {
    if (!event.body) throw new Error("Missing request body");
    const tableName = "workoutTable";
    const timestamp = new Date().toISOString();
    const inputData = JSON.parse(event.body);

    const {
      PK,
      SK: ignore1,
      targetDay,
      location,
      date,
      createdAt: ignore2,
      ...rest
    } = inputData;

    const newWorkout = {
      PK,
      SK: `WORKOUT#${date}`,
      targetDay,
      location,
      createdAt: timestamp,
      date,
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: newWorkout,
      })
    );
    return {
      statusCode: 201,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: JSON.stringify({
        message: "Created new workout",
        workout: newWorkout,
      }),
    };
  },

  "DELETE /workouts": async (event) => {
    const tableName = "workoutTable";
    const inputData = JSON.parse(event.body);
    const { pk, sk } = inputData;

    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: {
          PK: pk,
          SK: sk,
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Deleted item ${pk}, ${sk}` }),
    };
  },

  "PATCH /workouts": async (event) => {
    const inputData = JSON.parse(event.body);

    const { PK, targetDay } = inputData;

    if (!PK) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing 'pk' query parameter" }),
      };
    }

    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "GSI3",
        KeyConditionExpression: "targetDay = :targetDay AND PK = :PK",
        ExpressionAttributeValues: {
          ":targetDay": { S: targetDay },
          ":PK": { S: PK },
        },
      })
    );

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(result.Items ?? []),
    };
  },

  "GET /exercises": async (event) => {
    const pk = event.queryStringParameters?.pk;

    if (!pk) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing 'pk' query parameter" }),
      };
    }

    const getResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": { S: pk },
          ":skPrefix": { S: "EXERCISE#" },
        },
      })
    );

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(getResult.Items ?? []),
    };
  },
  "DELETE /exercises": async (event) => {
    const tableName = "workoutTable";
    const inputData = JSON.parse(event.body);
    const { pk, sk } = inputData;

    await client.send(
      new DeleteCommand({
        TableName: tableName,
        Key: {
          PK: pk,
          SK: sk,
        },
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Deleted item ${pk}, ${sk}` }),
    };
  },

  "POST /exercises": async (event) => {
    if (!event.body) throw new Error("Missing request body");
    const tableName = "workoutTable";
    const timestamp = new Date().toISOString();
    const inputData = JSON.parse(event.body);
    const {
      PK,
      SK: ignore1,
      exerciseName,
      numberOfSets,
      weight,
      unitMeasurement,
      createdAt: ignore2,
      ...rest
    } = inputData;
    const newExercise = {
      PK,
      SK: `EXERCISE#${timestamp}#${exerciseName}`,
      exerciseName,
      numberOfSets,
      weight,
      unitMeasurement,
      createdAt: timestamp,
    };
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: newExercise,
      })
    );
    return {
      statusCode: 201,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: JSON.stringify({
        message: "Created new exercise",
        exercise: newExercise,
      }),
    };
  },

  "GET /sets": async (event) => {
    const pk = event.queryStringParameters?.pk;

    if (!pk) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing 'pk' query parameter" }),
      };
    }

    const getResult = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": { S: pk },
          ":skPrefix": { S: "SET#" },
        },
      })
    );

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(getResult.Items ?? []),
    };
  },

  "POST /sets": async (event) => {
    if (!event.body) throw new Error("Missing request body");
    const tableName = "workoutTable";
    const timestamp = new Date().toISOString();
    const inputData = JSON.parse(event.body);
    const {
      PK,
      SK,
      numberOfReps,
      weight,
      createdAt: ignore2,
      ...rest
    } = inputData;
    const newSet = {
      PK,
      SK,
      numberOfReps,
      weight,
      createdAt: timestamp,
    };
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: newSet,
      })
    );
    return {
      statusCode: 201,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: JSON.stringify({
        message: "Created new set",
        set: newSet,
      }),
    };
  },

  "PATCH /sets": async (event) => {
    const tableName = "workoutTable";
    const timestamp = new Date().toISOString();

    const patchData = JSON.parse(event.body);
    const pk = patchData?.PK;
    const sk = patchData?.SK;
    if (!pk && !sk) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing 'pk' or 'sk' query parameter" }),
      };
    }

    const existing = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `${pk}`,
          SK: `${sk}`,
        },
      })
    );

    if (!existing.Item) {
      return {
        statusCode: StatusCodes.NOT_FOUND,
        body: JSON.stringify({
          message: `Not Found item ${pk} with sort key ${sk}`,
        }),
      };
    }

    const { PK, SK, createdAt } = existing.Item;

    // Step 2: Extract known and custom fields
    const {
      numberOfReps,
      weight,
      createdAt: ignore1,
      PK: ignore2,
      SK: ignore3,
      ...rest
    } = patchData;

    // Step 3: Build final updated item
    const updatedItem = {
      PK,
      SK,
      numberOfReps,
      weight,
      editedAt: timestamp,
      createdAt,
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
        message: `Updated item ${pk} with sort key ${sk}`,
        updated: updatedItem,
      }),
    };
  },

  "GET /items": async () => {
    const scanResult = await client.send(
      new ScanCommand({ TableName: tableName })
    );
    return scanResult.Items ?? [];
  },

  "GET /items/:id": async (_event, id) => {
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

  "POST /items": async (event) => {
    if (!event.body) throw new Error("Missing request body");

    const tableName = "todoTable";
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
      description: description ?? "",
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
        message: "Created new item",
        generatedId,
        item: newItem,
      }),
    };
  },

  "PATCH /items/:id": async (event, id) => {
    if (!event.body) throw new Error("Missing request body");

    const tableName = "todoTable";
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
      description: description ?? "",
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

  "DELETE /items/:id": async (_event, id) => {
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
    const [routeMethod, routePath] = key.split(" ");
    if (routeMethod !== method) continue;

    const match = path.match(
      new RegExp(`^${routePath.replace(":id", "([^/]+)")}$`)
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
  let body: string | object = "";

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
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
};
