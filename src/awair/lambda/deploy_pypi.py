#!/usr/bin/env python3
"""PyPI-based CDK deployment script for Awair Lambda infrastructure."""

import os
import sys
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from click import group, echo, pass_context, Abort, option
from utz.proc import run, check


def create_lambda_package_from_pypi(version: str = None) -> str:
    """Create a deployment package for AWS Lambda using PyPI release."""

    # Create temporary directory for the package
    with TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        package_dir = temp_path / "package"
        package_dir.mkdir()

        # Determine version to install
        if version:
            awair_package = f"awair=={version}"
            print(f"Installing awair {version} from PyPI...")
        else:
            awair_package = "awair"
            print("Installing latest awair from PyPI...")

        # Install awair package and dependencies to package directory
        run(sys.executable, "-m", "pip", "install",
            awair_package,
            "-t", str(package_dir),
            "--no-deps")  # Install awair without dependencies first

        # Install only runtime dependencies (no dev dependencies)
        print("Installing runtime dependencies...")
        runtime_deps = [
            "click>=8.0.0",
            "requests>=2.28.0",
            "pandas>=1.5.0",
            "pyarrow>=10.0.0",
            "utz>=0.20.0"  # Required for Lambda
        ]

        for dep in runtime_deps:
            run(sys.executable, "-m", "pip", "install",
                dep, "-t", str(package_dir))

        print("Copying Lambda handler...")
        # Copy lambda function (rename for Lambda handler)
        lambda_dir = Path(__file__).parent
        run("cp", "updater.py", str(package_dir / "lambda_function.py"),
            cwd=lambda_dir)

        # Bake in device configuration for Lambda
        print("Baking in device configuration...")
        try:
            # Import from the installed package
            sys.path.insert(0, str(package_dir))
            from awair.cli.config import get_device_info
            device_type, device_id = get_device_info()
            device_config_content = f"{device_type},{device_id}"

            # Create .awair directory in package
            awair_config_dir = package_dir / ".awair"
            awair_config_dir.mkdir()

            # Write device config file
            device_config_file = awair_config_dir / "device"
            with open(device_config_file, 'w') as f:
                f.write(device_config_content)

            print(f"Baked in device: {device_type} ID: {device_id}")

        except Exception as e:
            echo(f"Warning: Could not bake in device config: {e}", err=True)
            echo("Lambda will auto-discover device on first run", err=True)
        finally:
            # Clean up sys.path
            if str(package_dir) in sys.path:
                sys.path.remove(str(package_dir))

        print("Creating deployment package...")
        # Create ZIP file
        zip_path = Path(__file__).parent / "lambda-updater-pypi-deployment.zip"
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(package_dir):
                for file in files:
                    file_path = Path(root) / file
                    arc_name = file_path.relative_to(package_dir)
                    zipf.write(file_path, arc_name)

        print(f"Created {zip_path} ({zip_path.stat().st_size / 1024 / 1024:.1f} MB)")
        return str(zip_path)


def deploy_with_cdk_pypi(awair_token: str, data_path: str, version: str = None,
                        stack_name: str = "awair-data-updater"):
    """Deploy using CDK with PyPI-based package."""
    lambda_dir = Path(__file__).parent

    # Set token and data path in environment for CDK app
    env = os.environ.copy()
    env['AWAIR_TOKEN'] = awair_token
    env['AWAIR_DATA_PATH'] = data_path
    env['AWAIR_LAMBDA_PACKAGE'] = 'pypi'  # Signal to use PyPI package
    if version:
        env['AWAIR_VERSION'] = version

    print(f"Deploying CDK stack: {stack_name}")
    print(f"Target S3 location: {data_path}")
    if version:
        print(f"Using awair version: {version}")
    else:
        print("Using latest awair version")

    # Run CDK deploy
    run("cdk", "deploy", stack_name,
        "--app", f"python {lambda_dir / 'app.py'}",
        "--require-approval", "never",
        env=env, cwd=lambda_dir)


@group(invoke_without_command=True)
@pass_context
def main(ctx):
    """PyPI-based CDK deployment for Awair Lambda infrastructure."""
    if ctx.invoked_subcommand is None:
        # Default to deploy
        ctx.invoke(deploy)


@main.command
@option('-v', '--version', help='Specific awair version to deploy (e.g., 0.0.1)')
def deploy(version: str = None):
    """Deploy the stack using PyPI release."""
    try:
        # Get token and data path via unified flows
        from awair.cli.config import get_token, get_default_data_path
        token = get_token()
        data_path = get_default_data_path()

        install_cdk_dependencies()
        bootstrap_cdk()
        create_lambda_package_from_pypi(version)
        deploy_with_cdk_pypi(token, data_path, version)

        echo("\n✅ PyPI-based CDK deployment complete!")
        echo(f"Lambda will run every 5 minutes, updating {data_path}")
        if version:
            echo(f"Deployed awair version: {version}")
        echo("Monitor logs: aws logs tail /aws/lambda/awair-data-updater --follow")

    except Exception as e:
        echo(f"❌ Deployment failed: {e}", err=True)
        raise Abort()


@main.command
@option('-v', '--version', help='Specific awair version to package (e.g., 0.0.1)')
def package(version: str = None):
    """Create Lambda package from PyPI release only."""
    try:
        zip_path = create_lambda_package_from_pypi(version)
        echo(f"✅ PyPI-based package created: {zip_path}")
        if version:
            echo(f"Using awair version: {version}")

    except Exception as e:
        echo(f"❌ Package creation failed: {e}", err=True)
        raise Abort()


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


if __name__ == "__main__":
    main()
