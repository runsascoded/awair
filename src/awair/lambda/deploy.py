#!/usr/bin/env python3
"""CDK deployment script for Awair Lambda infrastructure."""

import os
import sys
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from click import group, echo, pass_context, Abort
from utz.proc import run, output, check


def create_lambda_package() -> str:
    """Create a deployment package for AWS Lambda."""

    # Create temporary directory for the package
    with TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        package_dir = temp_path / "package"
        package_dir.mkdir()

        print("Installing dependencies...")
        # Install dependencies to package directory
        run(sys.executable, "-m", "pip", "install",
            "-r", "requirements.txt",
            "-t", str(package_dir),
            cwd=Path(__file__).parent)

        print("Copying source files...")
        # Copy lambda function (rename for Lambda handler)
        run("cp", "updater.py", str(package_dir / "lambda_function.py"),
            cwd=Path(__file__).parent)

        # Copy awair module from project root (excluding lambda directory to avoid recursion)
        project_root = Path(__file__).parent.parent.parent.parent
        awair_src = project_root / "src" / "awair"
        awair_dest = package_dir / "awair"

        # Copy all files except the lambda directory
        run("mkdir", "-p", str(awair_dest))
        for item in awair_src.iterdir():
            if item.name != "lambda":  # Skip lambda directory to avoid recursion
                if item.is_dir():
                    run("cp", "-r", str(item), str(awair_dest))
                else:
                    run("cp", str(item), str(awair_dest))

        print("Creating deployment package...")
        # Create ZIP file
        zip_path = Path(__file__).parent / "lambda-updater-deployment.zip"
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(package_dir):
                for file in files:
                    file_path = Path(root) / file
                    arc_name = file_path.relative_to(package_dir)
                    zipf.write(file_path, arc_name)

        print(f"Created {zip_path} ({zip_path.stat().st_size / 1024 / 1024:.1f} MB)")

        return str(zip_path)


def install_cdk_dependencies():
    """Install CDK dependencies if not already installed."""
    if check(sys.executable, "-c", "import aws_cdk"):
        print("CDK dependencies already installed")
    else:
        print("Installing CDK dependencies...")
        run(sys.executable, "-m", "pip", "install",
            "aws-cdk-lib>=2.0.0",
            "constructs>=10.0.0")


def bootstrap_cdk():
    """Bootstrap CDK if needed."""
    if not check("aws", "cloudformation", "describe-stacks", "--stack-name", "CDKToolkit"):
        print("Bootstrapping CDK...")
        run("cdk", "bootstrap")
    else:
        print("CDK already bootstrapped")


def deploy_with_cdk(awair_token: str, stack_name: str = "awair-data-updater"):
    """Deploy using CDK."""
    lambda_dir = Path(__file__).parent

    # Set token in environment for CDK app (unified flow)
    env = os.environ.copy()
    env['AWAIR_TOKEN'] = awair_token

    print(f"Deploying CDK stack: {stack_name}")

    # Run CDK deploy
    run("cdk", "deploy", stack_name,
        "--app", f"python {lambda_dir / 'app.py'}",
        "--require-approval", "never",
        env=env, cwd=lambda_dir)


def synthesize_cloudformation(awair_token: str, stack_name: str = "awair-data-updater") -> str:
    """Synthesize CloudFormation template from CDK."""
    lambda_dir = Path(__file__).parent

    # Set token in environment for CDK app (unified flow)
    env = os.environ.copy()
    env['AWAIR_TOKEN'] = awair_token

    print("Synthesizing CloudFormation template...")

    # Create CDK app and synthesize
    return output("cdk", "synth", stack_name,
                  "--app", f"python {lambda_dir / 'app.py'}",
                  env=env, cwd=lambda_dir).decode()


@group(invoke_without_command=True)
@pass_context
def main(ctx):
    """CDK deployment for Awair Lambda infrastructure."""
    if ctx.invoked_subcommand is None:
        # Default to deploy
        ctx.invoke(deploy)


@main.command
def deploy():
    """Deploy the stack."""
    try:
        # Get token via unified flow
        from awair.cli import get_token
        token = get_token()

        install_cdk_dependencies()
        bootstrap_cdk()
        create_lambda_package()
        deploy_with_cdk(token)

        echo("\n✅ CDK deployment complete!")
        echo("Lambda will run every 5 minutes, updating s3://380nwk/awair.parquet")
        echo("Monitor logs: aws logs tail /aws/lambda/awair-data-updater-updater --follow")

    except Exception as e:
        echo(f"❌ Deployment failed: {e}", err=True)
        raise Abort()


@main.command
def synth():
    """Synthesize CloudFormation template."""
    try:
        # Get token via unified flow
        from awair.cli import get_token
        token = get_token()

        install_cdk_dependencies()
        create_lambda_package()  # CDK needs the zip file to exist
        template = synthesize_cloudformation(token)
        echo("CloudFormation template:")
        echo(template)

    except Exception as e:
        echo(f"❌ Synthesis failed: {e}", err=True)
        raise Abort()


@main.command
def package():
    """Create Lambda package only."""
    try:
        zip_path = create_lambda_package()
        echo(f"✅ Package created: {zip_path}")

    except Exception as e:
        echo(f"❌ Package creation failed: {e}", err=True)
        raise Abort()


if __name__ == "__main__":
    main()
