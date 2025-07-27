// lib/api-stack.ts
import { Stack, StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigateway from "aws-cdk-lib/aws-apigateway";

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

function addCorsOptions(resource: apigateway.IResource) {
  try {
    resource.addMethod(
      "OPTIONS",
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Headers":
                "'Content-Type,X-Amz-Date,Authorization,X-Api-Key'",
              "method.response.header.Access-Control-Allow-Origin": "'*'",
              "method.response.header.Access-Control-Allow-Methods":
                "'GET,POST,OPTIONS,PATCH,DELETE'",
            },
            responseTemplates: {
              "application/json": "",
            },
          },
        ],
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        requestTemplates: {
          "application/json": '{"statusCode": 200}',
        },
      }),
      {
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Headers": true,
              "method.response.header.Access-Control-Allow-Origin": true,
              "method.response.header.Access-Control-Allow-Methods": true,
            },
          },
        ],
      }
    );
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("There is already a Construct with name 'OPTIONS'")
    ) {
      // silently skip duplicate OPTIONS error
    } else {
      throw e;
    }
  }
}

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

    const restApi = new apigateway.RestApi(this, "CrudRestApi", {
      restApiName: "workoutApi",
      defaultCorsPreflightOptions: {
        allowHeaders: ["Content-Type"],
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowOrigins: [
          "http://localhost:5173",
          "http://provincial-workout-app.s3-website-us-east-1.amazonaws.com",
        ],
        allowCredentials: true,
      },
    });

    const usersResource = restApi.root.addResource("users");

    usersResource.addMethod("GET", new apigateway.LambdaIntegration(usersFn));
    usersResource.addMethod("POST", new apigateway.LambdaIntegration(usersFn));

    const loginResource = restApi.root.addResource("login");

    loginResource.addMethod("POST", new apigateway.LambdaIntegration(usersFn), {
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
            "method.response.header.Access-Control-Allow-Headers": true,
            "method.response.header.Access-Control-Allow-Methods": true,
          },
        },
      ],
    });

    addCorsOptions(loginResource);

    const workoutResource = restApi.root.addResource("workouts");

    workoutResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(workoutsFn)
    );
    workoutResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(workoutsFn)
    );
    workoutResource.addMethod(
      "PATCH",
      new apigateway.LambdaIntegration(workoutsFn)
    );
    workoutResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(workoutsFn)
    );

    const filterResource = workoutResource.addResource("filter");
    filterResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(workoutsFn)
    );

    const exerciseResource = restApi.root.addResource("exercises");

    exerciseResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(exercisesFn)
    );
    exerciseResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(exercisesFn)
    );
    exerciseResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(exercisesFn)
    );

    const setResource = restApi.root.addResource("sets");

    setResource.addMethod("GET", new apigateway.LambdaIntegration(setsFn));
    setResource.addMethod("POST", new apigateway.LambdaIntegration(setsFn));
    setResource.addMethod("PATCH", new apigateway.LambdaIntegration(setsFn));
  }
}
