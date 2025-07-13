"""Lambda deployment and management commands."""

import sys
import subprocess
from os.path import join, dirname, exists

from click import option

from .base import awair
from .config import get_token, err
from .common_opts import version_opt
import awair.lmbda.deploy as deploy_module


# Common paths
LAMBDA_DIR = join(dirname(__file__), '..', 'lmbda')


@awair.group('lambda')
def cli():
    """AWS Lambda operations for scheduled data updates."""
    pass


@cli.command
@option('-n', '--dry-run', is_flag=True, help='Build package only, do not deploy')
@version_opt
def deploy(version: str = None, dry_run: bool = False):
    """Deploy the scheduled Lambda updater to AWS using CDK."""
    # Validate token via unified flow and pass to subprocess
    try:
        token = get_token()
    except ValueError as e:
        err(f'Token error: {e}')
        sys.exit(1)

    # Use unified deployment script
    deploy_script = join(LAMBDA_DIR, 'deploy.py')

    # Determine deployment type for logging
    use_source = version in ['source', 'src']
    if use_source:
        deployment_type = "source"
    else:
        deployment_type = f"PyPI {version}" if version else "PyPI latest"

    if not exists(deploy_script):
        err('Deployment script not found')
        return

    try:
        if dry_run:
            deploy_module.package_lambda(version)
        else:
            deploy_module.deploy_lambda(version)

    except Exception as e:
        err(f'{deployment_type} deployment failed: {e}')
        sys.exit(1)


@cli.command
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


@cli.command
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
        deploy_module.synth_lambda()

    except Exception as e:
        err(f'Synthesis failed: {e}')
        sys.exit(1)


@cli.command
@version_opt
def package(version: str = None):
    """Create Lambda deployment package only (without deploying)."""
    try:
        deploy_module.package_lambda(version)
    except Exception as e:
        err(f'Package creation failed: {e}')
        sys.exit(1)


@cli.command
@option('--follow', '-f', is_flag=True, help='Follow logs in real-time')
@option('--stack-name', default='awair-data-updater', help='CloudFormation stack name')
@option('--since', '-s', default='1h', help='Show logs since this time (e.g., "1h", "30m", "2d")')
def logs(follow: bool, stack_name: str, since: str):
    """View Lambda function logs."""
    function_name = stack_name
    log_group = f'/aws/lambda/{function_name}'

    cmd = ['aws', 'logs', 'tail', log_group, '--since', since]
    if follow:
        cmd.append('--follow')

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        err(f'Failed to fetch logs: {e}')
        sys.exit(1)

