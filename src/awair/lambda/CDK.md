# CDK Implementation

This directory uses **AWS CDK** for infrastructure as code.

## CDK Benefits

✅ **Type safety** - Python classes with IDE completion
✅ **Higher-level abstractions** - `Duration.minutes(5)` vs `"rate(5 minutes)"`
✅ **Better resource management** - Automatic dependencies and references
✅ **Easier testing** - Can unit test infrastructure code
✅ **Cleaner code** - Object-oriented vs YAML/JSON

## Files

- `app.py` - CDK application and stack definition
- `deploy.py` - Deployment script with dependency management
- `cdk.json` - CDK configuration
- `requirements-deploy.txt` - CDK Python dependencies
- `updater.py` - Lambda function code
- `requirements.txt` - Lambda runtime dependencies

## Usage

```bash
# Deploy with CDK
awair lambda deploy --token YOUR_TOKEN

# See generated CloudFormation
awair lambda synth --token YOUR_TOKEN

# Build package only
awair lambda deploy --dry-run
```

## CDK Features Used

- **Constructs** - Reusable infrastructure components
- **IAM Policies** - Type-safe policy definitions
- **Event Scheduling** - `Schedule.rate(Duration.minutes(5))`
- **Lambda Functions** - Automatic handler configuration
- **CloudWatch Logs** - Automatic log group creation with retention
- **Outputs** - Exported values for cross-stack references

## Dependencies

CDK deployment automatically installs:
- `aws-cdk-lib>=2.100.0` - Core CDK library
- `constructs>=10.0.0` - Construct base classes

Plus the standard Lambda runtime dependencies from `requirements.txt`.

## Why CDK?

CDK provides significant advantages over raw CloudFormation:

1. **Better developer experience** - IDE completion, type checking
2. **Easier maintenance** - Object-oriented code vs YAML
3. **Automatic best practices** - CDK applies AWS recommendations
4. **Future extensibility** - Easy to add API Gateway, DynamoDB, etc.
5. **Code reuse** - Share constructs across projects