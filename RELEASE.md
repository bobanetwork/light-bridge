# Release

To create a new release: 
1. Change the `package.json` version to the version you want to upgrade to.
2. Push the change and wait for the tests to succeed.
3. Create a new Github release. The Docker image is automatically being released. 
4. Go to the infra repo and adapt: `cfn-configs/ethereum-testnet/services/lightbridge/lightbridge-ecs.json`
5. Then confirm the changes on the [AWS CodePipeline](https://us-east-2.console.aws.amazon.com/codesuite/codepipeline/pipelines/ethereum-testnet-services-pipeline/view?region=us-east-2)