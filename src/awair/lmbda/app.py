#!/usr/bin/env python3
"""CDK app for Awair Lambda infrastructure."""

import aws_cdk as cdk
from aws_cdk import (
    CfnOutput,
    Duration,
    Stack,
)
from aws_cdk import (
    aws_events as events,
)
from aws_cdk import (
    aws_events_targets as targets,
)
from aws_cdk import (
    aws_iam as iam,
)
from aws_cdk import (
    aws_lambda as _lambda,
)
from constructs import Construct


class AwairLambdaStack(Stack):
    """Stack for Awair scheduled data updater Lambda."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        awair_token: str,
        data_path: str,
        package_type: str = 'source',
        version: str = None,
        refresh_interval_minutes: int = 3,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Parse S3 path for IAM permissions
        if not data_path.startswith('s3://'):
            raise ValueError(f'Lambda requires S3 data path, got: {data_path}')

        s3_path = data_path[5:]  # Remove 's3://'
        parts = s3_path.split('/', 1)
        s3_bucket = parts[0]
        s3_key = parts[1] if len(parts) > 1 else ''

        if not s3_bucket or not s3_key:
            raise ValueError(f'Invalid S3 path: {data_path}. Expected format: s3://bucket/key')

        # IAM role for Lambda
        lambda_role = iam.Role(
            self, "LambdaExecutionRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("service-role/AWSLambdaBasicExecutionRole")
            ],
            inline_policies={
                "S3Access": iam.PolicyDocument(
                    statements=[
                        iam.PolicyStatement(
                            effect=iam.Effect.ALLOW,
                            actions=[
                                "s3:GetObject",
                                "s3:PutObject",
                                "s3:DeleteObject"
                            ],
                            resources=[f"arn:aws:s3:::{s3_bucket}/{s3_key}"]
                        ),
                        iam.PolicyStatement(
                            effect=iam.Effect.ALLOW,
                            actions=["s3:ListBucket"],
                            resources=[f"arn:aws:s3:::{s3_bucket}"]
                        )
                    ]
                )
            }
        )

        # Determine deployment package based on package type
        if package_type == 'pypi':
            deployment_zip = 'lambda-updater-pypi-deployment.zip'
            description_suffix = f' (PyPI {version})' if version else ' (PyPI latest)'
        else:
            deployment_zip = 'lambda-updater-deployment.zip'
            description_suffix = ' (source)'

        # Lambda function
        updater_function = _lambda.Function(
            self, "AwairDataUpdaterFunction",
            function_name=construct_id,
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="lambda_function.lambda_handler",
            code=_lambda.Code.from_asset(deployment_zip),
            timeout=Duration.minutes(5),
            memory_size=512,
            reserved_concurrent_executions=1,
            environment={
                "AWAIR_TOKEN": awair_token,
                "AWAIR_DATA_PATH": data_path,
                "AWAIR_VERSION": version or "unknown",
                "AWAIR_REFRESH_INTERVAL_MINUTES": str(refresh_interval_minutes)
            },
            layers=[
                _lambda.LayerVersion.from_layer_version_arn(
                    self, "AWSSDKPandasLayer",
                    layer_version_arn="arn:aws:lambda:us-east-1:336392948345:layer:AWSSDKPandas-Python312:18"
                )
            ],
            role=lambda_role,
            description=f"Scheduled Awair data updater - fetches sensor data every {refresh_interval_minutes} minutes{description_suffix}"
        )

        # EventBridge rule for scheduling
        schedule_rule = events.Rule(
            self, "UpdateScheduleRule",
            rule_name=f"{construct_id}-schedule",
            description=f"Trigger Awair data update every {refresh_interval_minutes} minutes",
            schedule=events.Schedule.rate(Duration.minutes(refresh_interval_minutes)),
            enabled=True
        )

        # Add Lambda as target for the schedule
        schedule_rule.add_target(targets.LambdaFunction(updater_function))

        # Lambda automatically creates log groups, so we don't need to manage them

        # Outputs
        CfnOutput(
            self, "LambdaFunctionArn",
            value=updater_function.function_arn,
            description="Lambda Function ARN",
            export_name=f"{construct_id}-LambdaArn"
        )

        CfnOutput(
            self, "ScheduleRuleArn",
            value=schedule_rule.rule_arn,
            description="EventBridge Schedule Rule ARN",
            export_name=f"{construct_id}-ScheduleArn"
        )

        CfnOutput(
            self, "S3DataLocation",
            value=data_path,
            description="S3 location of the Parquet data file",
            export_name=f"{construct_id}-S3Location"
        )

        # Store references for access from app
        self.lambda_function = updater_function
        self.schedule_rule = schedule_rule


class AwairCdkApp(cdk.App):
    """CDK App for Awair infrastructure."""

    def __init__(
        self,
        awair_token: str,
        data_path: str,
        stack_name: str = 'awair-data-updater',
        package_type: str = 'source',
        version: str = None,
        refresh_interval_minutes: int = 3,
    ):
        super().__init__()

        # Create the stack
        self.stack = AwairLambdaStack(
            self,
            stack_name,
            awair_token=awair_token,
            data_path=data_path,
            package_type=package_type,
            version=version,
            refresh_interval_minutes=refresh_interval_minutes,
            description='Awair Data Updater - Scheduled Lambda for S3 updates',
            env=cdk.Environment(
                # Use default AWS credentials/region
                account=None,
                region=None,
            ),
        )


def create_app(
    awair_token: str,
    data_path: str,
    stack_name: str = 'awair-data-updater',
    package_type: str = 'source',
    version: str = None,
    refresh_interval_minutes: int = 3,
) -> AwairCdkApp:
    """Create and return the CDK app."""
    return AwairCdkApp(awair_token, data_path, stack_name, package_type, version, refresh_interval_minutes)


if __name__ == '__main__':
    import os

    from awair.cli.config import get_default_data_path, get_token

    # Use unified token and data path flows
    try:
        token = get_token()
        data_path = get_default_data_path()

        # Check for deployment configuration environment variables
        package_type = os.getenv('AWAIR_LAMBDA_PACKAGE', 'source')
        version = os.getenv('AWAIR_VERSION')
        refresh_interval = int(os.getenv('AWAIR_REFRESH_INTERVAL_MINUTES', '3'))

    except ValueError as e:
        print(f'Configuration error: {e}')
        import sys

        sys.exit(1)

    app = create_app(
        token,
        data_path,
        package_type=package_type,
        version=version,
        refresh_interval_minutes=refresh_interval,
    )

    # Synthesize the app (generate CloudFormation)
    app.synth()
