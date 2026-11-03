@description('Name of the Azure Static Web App in the existing resource group.')
@minLength(1)
param siteName string

@description('An Azure Static Web Apps region.')
param location string = 'westeurope'

resource site 'Microsoft.Web/staticSites@2025-03-01' = {
  name: siteName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  tags: {
    env: 'prod'
    workload: 'ciplek-control-tower'
    owner: 'frkim'
    costCenter: 'demo'
    dataClassification: 'public'
  }
  properties: {
    provider: 'Custom'
    stagingEnvironmentPolicy: 'Disabled'
  }
}
