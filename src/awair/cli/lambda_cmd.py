"""Lambda deployment and management commands."""

import sys
import subprocess
from os import environ
from os.path import join, dirname, exists

from click import group, command, option

from .config import get_token, get_default_data_path, err


# Common paths
LAMBDA_DIR = join(dirname(__file__), '..', 'lambda')


@group()
def lambda_cli():
    """AWS Lambda operations for scheduled data updates."""
    pass


@lambda_cli.command
@option('--dry-run', is_flag=True, help='Build package only, do not deploy')
def deploy(dry_run: bool):
    """Deploy the scheduled Lambda updater to AWS using CDK."""
    # Validate token via unified flow and pass to subprocess
    try:
        token = get_token()
    except ValueError as e:
        err(f'Token error: {e}')
        sys.exit(1)

    deploy_script = join(LAMBDA_DIR, 'deploy.py')

    if not exists(deploy_script):
        err('Deployment script not found')
        return

    try:
        # Set token and data path in environment for subprocess
        env = environ.copy()
        env['AWAIR_TOKEN'] = token
        env['AWAIR_DATA_PATH'] = get_default_data_path()

        if dry_run:
            cmd = [sys.executable, deploy_script, 'package']
        else:
            cmd = [sys.executable, deploy_script, 'deploy']

        subprocess.run(cmd, check=True, env=env, cwd=LAMBDA_DIR)

    except subprocess.CalledProcessError as e:
        err(f'Deployment failed: {e}')
        sys.exit(1)


@lambda_cli.command
def test():
    """Test the Lambda updater locally (without S3)."""
    test_script = join(LAMBDA_DIR, 'test_updater.py')

    if not exists(test_script):
        err('Lambda test script not found')
        return

    try:
        subprocess.run([sys.executable, test_script], check=True, cwd=LAMBDA_DIR)
    except subprocess.CalledProcessError as e:
        err(f'Test failed: {e}')
        sys.exit(1)


@lambda_cli.command
def synth():
    """Synthesize CloudFormation template from CDK (without deploying)."""
    # Validate token via unified flow and pass to subprocess
    try:
        token = get_token()
    except ValueError as e:
        err(f'Token error: {e}')
        sys.exit(1)

    deploy_script = join(LAMBDA_DIR, 'deploy.py')

    if not exists(deploy_script):
        err('Deployment script not found')
        return

    try:
        # Set token and data path in environment for subprocess
        env = environ.copy()
        env['AWAIR_TOKEN'] = token
        env['AWAIR_DATA_PATH'] = get_default_data_path()

        cmd = [sys.executable, deploy_script, 'synth']
        subprocess.run(cmd, check=True, env=env, cwd=LAMBDA_DIR)

    except subprocess.CalledProcessError as e:
        err(f'Synthesis failed: {e}')
        sys.exit(1)


@lambda_cli.command
@option('--follow', '-f', is_flag=True, help='Follow logs in real-time')
@option('--stack-name', default='awair-data-updater', help='CloudFormation stack name')
def logs(follow: bool, stack_name: str):
    """View Lambda function logs."""
    function_name = stack_name
    log_group = f'/aws/lambda/{function_name}'

    cmd = ['aws', 'logs', 'tail', log_group]
    if follow:
        cmd.append('--follow')

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        err(f'Failed to fetch logs: {e}')
        sys.exit(1)