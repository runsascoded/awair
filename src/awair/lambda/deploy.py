#!/usr/bin/env python3
"""Deploy the Awair Data Updater Lambda to AWS."""

import os
import sys
import subprocess
import tempfile
import zipfile
from pathlib import Path

def create_lambda_package():
    """Create a deployment package for AWS Lambda."""

    # Create temporary directory for the package
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        package_dir = temp_path / "package"
        package_dir.mkdir()

        print("Installing dependencies...")
        # Install dependencies to package directory
        subprocess.run([
            sys.executable, "-m", "pip", "install",
            "-r", "requirements.txt",
            "-t", str(package_dir)
        ], check=True, cwd=Path(__file__).parent)

        print("Copying source files...")
        # Copy lambda function (rename for Lambda handler)
        subprocess.run([
            "cp", "updater.py", str(package_dir / "lambda_function.py")
        ], check=True, cwd=Path(__file__).parent)

        # Copy awair module from project root
        project_root = Path(__file__).parent.parent.parent.parent
        subprocess.run([
            "cp", "-r", str(project_root / "src" / "awair"), str(package_dir)
        ], check=True)

        print("Creating deployment package...")
        # Create ZIP file
        zip_path = "lambda-updater-deployment.zip"
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(package_dir):
                for file in files:
                    file_path = Path(root) / file
                    arc_name = file_path.relative_to(package_dir)
                    zipf.write(file_path, arc_name)

        print(f"Created {zip_path} ({Path(zip_path).stat().st_size / 1024 / 1024:.1f} MB)")

        return zip_path

def deploy_stack(awair_token):
    """Deploy the CloudFormation stack."""
    stack_name = "awair-data-updater"

    print(f"Deploying CloudFormation stack: {stack_name}")
    subprocess.run([
        "aws", "cloudformation", "deploy",
        "--template-file", "cloudformation.yaml",
        "--stack-name", stack_name,
        "--parameter-overrides", f"AwairToken={awair_token}",
        "--capabilities", "CAPABILITY_NAMED_IAM"
    ], check=True, cwd=Path(__file__).parent)

    return stack_name

def update_lambda_code(stack_name, zip_path):
    """Update the Lambda function code."""
    function_name = f"{stack_name}-updater"

    print(f"Updating Lambda function code: {function_name}")
    subprocess.run([
        "aws", "lambda", "update-function-code",
        "--function-name", function_name,
        "--zip-file", f"fileb://{zip_path}"
    ], check=True)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python deploy-updater.py <awair-token> [deploy]")
        print("  <awair-token>: Your Awair API token")
        print("  deploy: Actually deploy to AWS (optional)")
        sys.exit(1)

    awair_token = sys.argv[1]
    should_deploy = len(sys.argv) > 2 and sys.argv[2] == "deploy"

    print("Building Lambda deployment package...")
    zip_path = create_lambda_package()

    if should_deploy:
        print("\nDeploying to AWS...")
        stack_name = deploy_stack(awair_token)
        update_lambda_code(stack_name, zip_path)
        print("\n✅ Deployment complete!")
        print(f"Lambda will run every 5 minutes, updating s3://380nwk/awair.parquet")
        print(f"Monitor logs: aws logs tail /aws/lambda/{stack_name}-updater --follow")
    else:
        print(f"\n📦 Package created: {zip_path}")
        print(f"To deploy: python deploy-updater.py {awair_token} deploy")