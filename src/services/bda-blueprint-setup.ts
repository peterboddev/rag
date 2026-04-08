/**
 * BDA Blueprint Setup — utilities for creating/updating the BDA project
 * and custom blueprint for insurance claims extraction.
 *
 * Used by a setup script or CDK custom resource, not at runtime.
 */

import {
  BedrockDataAutomationClient,
  CreateBlueprintCommand,
  CreateDataAutomationProjectCommand,
  Type as BlueprintType,
} from '@aws-sdk/client-bedrock-data-automation';

/** Insurance claims blueprint schema defining all 14 extraction fields. */
export const INSURANCE_CLAIMS_BLUEPRINT_SCHEMA = {
  documentType: 'InsuranceClaim',
  fields: [
    { name: 'patientName', type: 'string', description: 'Full name of the patient' },
    { name: 'patientId', type: 'string', description: 'Patient identifier or member ID' },
    { name: 'dateOfBirth', type: 'string', description: 'Patient date of birth in ISO format' },
    { name: 'billedAmount', type: 'number', description: 'Total amount billed' },
    { name: 'allowedAmount', type: 'number', description: 'Amount allowed by insurance' },
    { name: 'paidAmount', type: 'number', description: 'Amount paid by insurance' },
    { name: 'patientResponsibility', type: 'number', description: 'Amount patient is responsible for' },
    { name: 'serviceDate', type: 'string', description: 'Date of service in ISO format' },
    { name: 'paymentDate', type: 'string', description: 'Date of payment in ISO format' },
    { name: 'claimStatus', type: 'string', description: 'Claim status: approved, denied, or pending' },
    { name: 'diagnosisCodes', type: 'array', description: 'ICD-10 diagnosis codes' },
    { name: 'procedureCodes', type: 'array', description: 'CPT procedure codes' },
    { name: 'providerName', type: 'string', description: 'Healthcare provider name' },
    { name: 'providerNPI', type: 'string', description: 'Provider National Provider Identifier' },
  ],
};

/**
 * Create the insurance claims BDA blueprint.
 * Returns the blueprint ARN.
 */
export async function createInsuranceClaimsBlueprint(region: string): Promise<string> {
  const client = new BedrockDataAutomationClient({ region });

  const command = new CreateBlueprintCommand({
    blueprintName: 'InsuranceClaimsBlueprint',
    type: 'DOCUMENT' as BlueprintType,
    schema: JSON.stringify(INSURANCE_CLAIMS_BLUEPRINT_SCHEMA),
  });

  const response = await client.send(command);
  const arn = response.blueprint?.blueprintArn;
  if (!arn) {
    throw new Error('CreateBlueprintCommand did not return a blueprint ARN');
  }
  return arn;
}

/**
 * Create the BDA project referencing the blueprint.
 * Returns the project ARN.
 */
export async function createBdaProject(blueprintArn: string, region: string): Promise<string> {
  const client = new BedrockDataAutomationClient({ region });

  const command = new CreateDataAutomationProjectCommand({
    projectName: 'InsuranceClaimsProject',
    projectDescription: 'BDA project for insurance claims document extraction',
    standardOutputConfiguration: {
      document: undefined,
      image: undefined,
      audio: undefined,
      video: undefined,
    },
    customOutputConfiguration: {
      blueprints: [
        {
          blueprintArn,
        },
      ],
    },
  });

  const response = await client.send(command);
  const arn = response.projectArn;
  if (!arn) {
    throw new Error('CreateDataAutomationProjectCommand did not return a project ARN');
  }
  return arn;
}
