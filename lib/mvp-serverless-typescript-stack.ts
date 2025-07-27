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
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

export class MvpServerlessTypescriptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: "provincial-workout-app",
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "index.html",
      publicReadAccess: true,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new s3Deploy.BucketDeployment(this, "DeployFrontend", {
      sources: [s3Deploy.Source.asset("../workout-frontend/dist")],
      destinationBucket: siteBucket,
    });

    new CfnOutput(this, "WebsiteURL", {
      value: siteBucket.bucketWebsiteUrl,
      description: "The static website URL hosted on S3",
    });

    // SINGLE TABLE DESIGN: Use partition key (PK) and sort key (SK)
    const table = new dynamodb.Table(this, "AppDataTable", {
      tableName: "workoutTable",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const usersFn = new lambda.Function(this, "UserLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/dist")),
      handler: "index.handler",
      functionName: "user-function",
    });

    const workoutsFn = new lambda.Function(this, "WorkoutLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/dist")),
      handler: "index.handler",
      functionName: "workouts-function",
    });

    const exercisesFn = new lambda.Function(this, "ExerciseLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/dist")),
      handler: "index.handler",
      functionName: "exercise-function",
    });

    const setsFn = new lambda.Function(this, "SetLambda", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset(path.join(__dirname, "../src/dist")),
      handler: "index.handler",
      functionName: "sets-function",
    });

    table.grantReadWriteData(usersFn);
    table.grantReadWriteData(workoutsFn);
    table.grantReadWriteData(exercisesFn);
    table.grantReadWriteData(setsFn);

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
        allowOrigins: [
          "http://localhost:5173",
          "http://provincial-workout-app.s3-website-us-east-1.amazonaws.com",
        ],
        allowCredentials: true,
      },
    });

    const userLambdaIntegration = new HttpLambdaIntegration(
      "CrudIntegration",
      usersFn
    );
    const workoutLambdaIntegration = new HttpLambdaIntegration(
      "CrudIntegration",
      workoutsFn
    );

    const exerciseLambdaIntegration = new HttpLambdaIntegration(
      "CrudIntegration",
      exercisesFn
    );

    const setLambdaIntegration = new HttpLambdaIntegration(
      "CrudIntegration",
      setsFn
    );

    httpApi.addRoutes({
      path: "/items",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: userLambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/items/{id}",
      methods: [HttpMethod.GET, HttpMethod.DELETE, HttpMethod.PATCH],
      integration: userLambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/users",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: userLambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/login",
      methods: [HttpMethod.POST],
      integration: userLambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/workouts",
      methods: [
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.DELETE,
        HttpMethod.PATCH,
      ],
      integration: workoutLambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/workouts/filter",
      methods: [HttpMethod.GET],
      integration: workoutLambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/exercises",
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE],
      integration: exerciseLambdaIntegration,
    });

    httpApi.addRoutes({
      path: "/sets",
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PATCH],
      integration: setLambdaIntegration,
    });

    new CfnOutput(this, "ApiUrl", {
      exportName: "APIGatewayEndpoint",
      value: httpApi.apiEndpoint,
      description: "The endpoint url of the API Gateway",
    });
  }
}
