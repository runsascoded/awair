#!/usr/bin/env python3
"""Unified CDK deployment script for Awair Lambda infrastructure."""

import os
import sys
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from click import Abort, echo
from utz.proc import check, output, run


def bake_device_config(package_dir: Path, use_pypi_import: bool = False):
    """Bake device configuration into Lambda package."""
    print('Baking in device configuration...')
    try:
        if use_pypi_import:
            # Import from the installed PyPI package
            sys.path.insert(0, str(package_dir))
            from awair.cli.config import get_device_info
        else:
            # Import from local source
            from awair.cli.config import get_device_info

        device_type, device_id = get_device_info()
        device_config_content = f'{device_type},{device_id}'

        # Create .awair directory in package
        awair_config_dir = package_dir / '.awair'
        awair_config_dir.mkdir(exist_ok=True)

        # Write device config file
        device_config_file = awair_config_dir / 'device'
        with open(device_config_file, 'w') as f:
            f.write(device_config_content)

        print(f'Baked in device: {device_type} ID: {device_id}')

    except Exception as e:
        echo(f'Warning: Could not bake in device config: {e}', err=True)
        echo('Lambda will auto-discover device on first run', err=True)
    finally:
        # Clean up sys.path if we modified it
        if use_pypi_import and str(package_dir) in sys.path:
            sys.path.remove(str(package_dir))


def create_zip_package(package_dir: Path, package_type: str) -> str:
    """Create ZIP file from package directory."""
    print('Creating deployment package...')

    # Choose zip filename based on package type
    if package_type == 'pypi':
        zip_filename = 'lambda-updater-pypi-deployment.zip'
    else:
        zip_filename = 'lambda-updater-deployment.zip'

    zip_path = Path(__file__).parent / zip_filename

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(package_dir):
            for file in files:
                file_path = Path(root) / file
                arc_name = file_path.relative_to(package_dir)
                zipf.write(file_path, arc_name)

    print(f'Created {zip_path} ({zip_path.stat().st_size / 1024 / 1024:.1f} MB)')
    return str(zip_path)


def create_lambda_package(package_type: str = 'source', version: str = None) -> str:
    """Create a deployment package for AWS Lambda from source or PyPI."""

    with TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        package_dir = temp_path / 'package'
        package_dir.mkdir()

        if package_type == 'pypi':
            # PyPI-based package
            if version:
                awair_package = f'awair=={version}'
                print(f'Installing awair {version} from PyPI...')
            else:
                awair_package = 'awair'
                print('Installing latest awair from PyPI...')

            # Install awair package without dependencies first
            run(sys.executable, '-m', 'pip', 'install', awair_package, '-t', str(package_dir), '--no-deps')

            # Install only runtime dependencies (pandas/pyarrow come from layer)
            print("Installing runtime dependencies...")
            runtime_deps = [
                "click>=8.0.0",
                "requests>=2.28.0",
                "utz>=0.20.0"
            ]

            for dep in runtime_deps:
                run(sys.executable, '-m', 'pip', 'install', dep, '-t', str(package_dir))

            use_pypi_import = True
        else:
            # Source-based package
            print("Installing dependencies...")
            run(sys.executable, "-m", "pip", "install",
                "-r", "requirements.txt",
                "-t", str(package_dir),
                cwd=Path(__file__).parent)

            print('Copying source files...')
            # Copy awair module (excluding lmbda directory)
            # Path: /Users/ryan/c/380nwk/awair/src/awair/lmbda/deploy.py
            # We want: /Users/ryan/c/380nwk/awair/src/awair
            awair_src = Path(__file__).parent.parent
            awair_dest = package_dir / 'awair'

            # Create the awair directory structure
            awair_dest.mkdir(parents=True, exist_ok=True)

            # Copy all files and directories from awair_src to awair_dest, excluding lmbda
            for item in awair_src.iterdir():
                if item.name != 'lmbda':  # Skip lmbda directory to avoid recursion
                    dest_path = awair_dest / item.name
                    if item.is_dir():
                        # Use shutil.copytree for reliable recursive directory copying
                        import shutil

                        shutil.copytree(str(item), str(dest_path), dirs_exist_ok=True)
                    else:
                        # Copy individual files
                        import shutil

                        shutil.copy2(str(item), str(dest_path))

            use_pypi_import = False

        # Copy Lambda handler (common to both)
        print('Copying Lambda handler...')
        lambda_dir = Path(__file__).parent
        run('cp', 'updater.py', str(package_dir / 'lambda_function.py'), cwd=lambda_dir)

        # Bake in device configuration
        bake_device_config(package_dir, use_pypi_import)

        # Create ZIP package
        return create_zip_package(package_dir, package_type)


def install_cdk_dependencies():
    """Install CDK dependencies if not already installed."""
    if check(sys.executable, '-c', 'import aws_cdk'):
        print('CDK dependencies already installed')
    else:
        print('Installing CDK dependencies...')
        run(sys.executable, '-m', 'pip', 'install', 'aws-cdk-lib>=2.0.0', 'constructs>=10.0.0')


def bootstrap_cdk():
    """Bootstrap CDK if needed."""
    if not check('aws', 'cloudformation', 'describe-stacks', '--stack-name', 'CDKToolkit'):
        print('Bootstrapping CDK...')
        run('cdk', 'bootstrap')
    else:
        print('CDK already bootstrapped')


def deploy_with_cdk(awair_token: str, data_path: str, package_type: str = "source",
                   version: str = None, stack_name: str = "awair-data-updater",
                   refresh_interval_minutes: int = 3):
    """Deploy using CDK."""
    lambda_dir = Path(__file__).parent

    # Set configuration in environment for CDK app
    env = os.environ.copy()
    env['AWAIR_TOKEN'] = awair_token
    env['AWAIR_DATA_PATH'] = data_path
    env['AWAIR_LAMBDA_PACKAGE'] = package_type
    env['AWAIR_REFRESH_INTERVAL_MINUTES'] = str(refresh_interval_minutes)
    if version:
        env['AWAIR_VERSION'] = version

    print(f"Deploying CDK stack: {stack_name}")
    print(f"Target S3 location: {data_path}")
    print(f"Refresh interval: {refresh_interval_minutes} minutes")
    if package_type == "pypi":
        if version:
            print(f"Using awair version: {version}")
        else:
            print("Using latest awair version")
    else:
        print("Using source code")

    # Run CDK deploy
    run("cdk", "deploy", stack_name,
        "--app", f"python {lambda_dir / 'app.py'}",
        "--require-approval", "never",
        env=env, cwd=lambda_dir)


def synthesize_cloudformation(awair_token: str, data_path: str, stack_name: str = "awair-data-updater") -> str:
    """Synthesize CloudFormation template from CDK."""
    lambda_dir = Path(__file__).parent

    # Set token and data path in environment for CDK app (unified flow)
    env = os.environ.copy()
    env['AWAIR_TOKEN'] = awair_token
    env['AWAIR_DATA_PATH'] = data_path

    print("Synthesizing CloudFormation template...")
    print(f"Target S3 location: {data_path}")

    # Create CDK app and synthesize
    return output("cdk", "synth", stack_name,
                  "--app", f"python {lambda_dir / 'app.py'}",
                  env=env, cwd=lambda_dir).decode()


def deploy_lambda(version: str = None, refresh_interval_minutes: int = 3):
    """Deploy the stack."""
    try:
        # Get token and data path via unified flows
        from awair.cli.config import get_default_data_path, get_token

        token = get_token()
        data_path = get_default_data_path()

        # Determine package type: source if version is "source"/"src", otherwise PyPI
        use_source = version in ['source', 'src'] if version else False
        final_package_type = 'source' if use_source else 'pypi'
        final_version = None if use_source else version

        install_cdk_dependencies()
        bootstrap_cdk()
        create_lambda_package(final_package_type, final_version)
        deploy_with_cdk(token, data_path, final_package_type, final_version, refresh_interval_minutes=refresh_interval_minutes)

        echo('\n✅ CDK deployment complete!')
        echo(f'Lambda will run every {refresh_interval_minutes} minutes, updating {data_path}')
        if final_package_type == 'pypi' and final_version:
            echo(f'Deployed awair version: {final_version}')
        elif final_package_type == 'source':
            echo('Deployed from source code')
        echo('Monitor logs: aws logs tail /aws/lambda/awair-data-updater --follow')

    except Exception as e:
        echo(f'❌ Deployment failed: {e}', err=True)
        raise Abort()


def synth_lambda():
    """Synthesize CloudFormation template."""
    try:
        # Get token and data path via unified flows
        from awair.cli.config import get_default_data_path, get_token

        token = get_token()
        data_path = get_default_data_path()

        install_cdk_dependencies()
        create_lambda_package()  # CDK needs the zip file to exist
        template = synthesize_cloudformation(token, data_path)
        echo('CloudFormation template:')
        echo(template)

    except Exception as e:
        echo(f'❌ Synthesis failed: {e}', err=True)
        raise Abort()


def package_lambda(version: str = None):
    """Create Lambda package only."""
    try:
        # Determine package type: source if version is "source"/"src", otherwise PyPI
        use_source = version in ['source', 'src'] if version else False
        final_package_type = 'source' if use_source else 'pypi'
        final_version = None if use_source else version

        zip_path = create_lambda_package(final_package_type, final_version)
        echo(f'✅ Package created: {zip_path}')
        if final_package_type == 'pypi' and final_version:
            echo(f'Using awair version: {final_version}')
        elif final_package_type == 'source':
            echo('Using source code')

    except Exception as e:
        echo(f'❌ Package creation failed: {e}', err=True)
        raise Abort()
