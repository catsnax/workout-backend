// lib/api-stack.ts
import { Stack, StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import {
  HttpApi,
  CorsHttpMethod,
  HttpMethod,
} from "@aws-cdk/aws-apigatewayv2-alpha";
import path from "path";

export class MvpServerlessTypescriptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // SINGLE TABLE DESIGN: Use partition key (PK) and sort key (SK)
    const table = new dynamodb.Table(this, "AppDataTable", {
      tableName: "workoutTable",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new lambda.Function(this, "CrudLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/dist")),
      handler: "index.handler",
      functionName: "workout-function",
    });

    table.grantReadWriteData(fn);

    const httpApi = new HttpApi(this, "CrudHttpApi", {
      apiName: "workoutApi",
      corsPreflight: {
        allowHeaders: ["Content-Type"],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ["http://localhost:5173"],
        allowCredentials: true,
      },
    });

    const lambdaIntegration = new HttpLambdaIntegration("CrudIntegration", fn);

    httpApi.addRoutes({
      path: "/items",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/items/{id}",
      methods: [HttpMethod.GET, HttpMethod.DELETE, HttpMethod.PATCH],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/users",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/login",
      methods: [HttpMethod.POST],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/workouts",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: lambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/exercises",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: lambdaIntegration,
    });

    new CfnOutput(this, "ApiUrl", {
      exportName: "APIGatewayEndpoint",
      value: httpApi.apiEndpoint,
      description: "The endpoint url of the API Gateway",
    });
  }
}
