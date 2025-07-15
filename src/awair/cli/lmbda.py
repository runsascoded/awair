"""Lambda deployment and management commands."""

import subprocess
import sys
from os.path import dirname, exists, join

from click import option

from .base import awair
from .common_opts import version_opt
from .config import err, get_token

# Import deploy module conditionally - only when actually needed
# This prevents import errors when running in Lambda where lmbda directory is excluded
try:
    import awair.lmbda.deploy as deploy_module
except ImportError:
    deploy_module = None


# Common paths
LAMBDA_DIR = join(dirname(__file__), '..', 'lmbda')


@awair.group('lambda')
def cli():
    """AWS Lambda operations for scheduled data updates."""
    pass


@cli.command
@option('-n', '--dry-run', is_flag=True, help='Build package only, do not deploy')
@option('-r', '--refresh-interval', type=int, default=3, help='Update interval in minutes (default: 3)')
@version_opt
def deploy(version: str = None, dry_run: bool = False, refresh_interval: int = 3):
    """Deploy the scheduled Lambda updater to AWS using CDK."""
    # Validate token via unified flow and pass to subprocess
    try:
        get_token()  # Just validate token exists
    except ValueError as e:
        err(f'Token error: {e}')
        sys.exit(1)

    # Use unified deployment script
    deploy_script = join(LAMBDA_DIR, 'deploy.py')

    # Determine deployment type for logging
    use_source = version in ['source', 'src']
    if use_source:
        deployment_type = 'source'
    else:
        deployment_type = f'PyPI {version}' if version else 'PyPI latest'

    if not exists(deploy_script):
        err('Deployment script not found')
        return

    try:
        if deploy_module is None:
            err('Lambda deployment module not available (lmbda directory not found)')
            sys.exit(1)

        if dry_run:
            deploy_module.package_lambda(version)
        else:
            deploy_module.deploy_lambda(version, refresh_interval)

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
        subprocess.run([sys.executable, '-m', 'awair.lmbda.test_updater'], check=True)
    except subprocess.CalledProcessError as e:
        err(f'Test failed: {e}')
        sys.exit(1)


@cli.command
def synth():
    """Synthesize CloudFormation template from CDK (without deploying)."""
    # Validate token via unified flow and pass to subprocess
    try:
        get_token()  # Just validate token exists
    except ValueError as e:
        err(f'Token error: {e}')
        sys.exit(1)

    deploy_script = join(LAMBDA_DIR, 'deploy.py')

    if not exists(deploy_script):
        err('Deployment script not found')
        return

    try:
        if deploy_module is None:
            err('Lambda deployment module not available (lmbda directory not found)')
            sys.exit(1)

        deploy_module.synth_lambda()

    except Exception as e:
        err(f'Synthesis failed: {e}')
        sys.exit(1)


@cli.command
@version_opt
def package(version: str = None):
    """Create Lambda deployment package only (without deploying)."""
    try:
        if deploy_module is None:
            err('Lambda deployment module not available (lmbda directory not found)')
            sys.exit(1)

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
