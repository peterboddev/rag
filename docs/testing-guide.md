# Testing Guide - RAG Application with Cognito Authentication

## Current Status

✅ Infrastructure deployed successfully to AWS
✅ API Gateway configured with Cognito authorization
✅ Frontend integrated with AWS Amplify for authentication
✅ Tenant join bug fixed (authentication state now properly set)

## Test User Credentials

- **Username**: `testuser`
- **Email**: `test@example.com`
- **Password**: `TestPass123!`

## Testing the Application

### 1. Start the Frontend Development Server

```bash
cd frontend
npm start
```

The application will open at `http://localhost:3000`

### 2. Test Authentication Flow

#### Sign In
1. You should see the sign-in form
2. Enter credentials:
   - Email: `test@example.com`
   - Password: `TestPass123!`
3. Click "Sign In"
4. You should be redirected to the tenant setup page

#### Create a New Tenant
1. After signing in, you'll see two options: "Create New Tenant" or "Join Existing Tenant"
2. Click "Create New Tenant"
3. Enter a company name (e.g., "Test Company")
4. Click "Create Tenant"
5. You should see a success message with a tenant ID
6. The tenant ID will be displayed - save it for testing the join flow

#### Join an Existing Tenant
1. Sign out and sign in again
2. Click "Join Existing Tenant"
3. Enter the tenant ID from the previous step
4. Click "Join Tenant"
5. **Expected Result**: You should now see the main application with three tabs:
   - 📤 Upload Documents
   - 📋 Document Summary
   - 🏥 Patients

### 3. Test Main Application Features

#### Upload Documents Tab
1. Click "📤 Upload Documents"
2. Enter a customer email (e.g., `customer@example.com`)
3. Select a PDF, DOCX, or image file
4. Click "Upload Document"
5. **Expected Result**: Document should upload successfully and show processing status

#### Document Summary Tab
1. Click "📋 Document Summary"
2. Enter the same customer email used for upload
3. Click "Get Summary"
4. **Expected Result**: Should display a list of uploaded documents with their processing status

#### Patients Tab
1. Click "🏥 Patients"
2. **Expected Result**: Should display a list of patients from the medical claims data
3. Click on a patient to view their claim details

### 4. Test API Authentication

All API calls should now include the JWT token from Cognito. You can verify this by:

1. Open browser DevTools (F12)
2. Go to the Network tab
3. Perform any action (upload document, get summary, etc.)
4. Click on the API request
5. Check the "Headers" section
6. You should see: `Authorization: Bearer <jwt-token>`

### 5. Test Sign Out

1. Click the "Sign Out" button in the top-right corner
2. **Expected Result**: You should be redirected back to the sign-in page
3. Local storage should be cleared (tenant ID, company name, etc.)

## Known Issues and Limitations

### User Management
- Users must be created by an administrator in AWS Cognito
- Self-registration is disabled for security
- Contact your AWS administrator to create new test users

### Tenant Management
- Tenant IDs are currently stored in localStorage
- In production, tenant information should be stored in DynamoDB
- Tenant validation is not yet implemented (any tenant ID can be joined)

### API Endpoints
- Some endpoints may not be fully implemented yet
- Check the Lambda function logs in CloudWatch for detailed error messages

## Troubleshooting

### "There is already a signed in user" Error
This error occurs when Amplify has a cached session. To fix:
1. Clear browser localStorage
2. Refresh the page
3. Sign in again

### "Missing Authentication Token" Error
This means the API Gateway endpoint is not configured correctly. Verify:
1. API Gateway deployment is up to date
2. Stage is configured to use the latest deployment
3. Cognito authorizer is attached to the methods

### API Returns 401 Unauthorized
This means the JWT token is invalid or expired. Try:
1. Sign out and sign in again
2. Check that the Cognito User Pool ID and Client ID are correct in `.env`
3. Verify the API Gateway authorizer is configured correctly

### Documents Not Processing
Check the following:
1. Lambda function logs in CloudWatch
2. S3 bucket permissions
3. Textract service limits
4. DynamoDB table permissions

## Next Steps

### Recommended Improvements

1. **Tenant Management API**
   - Create backend API for tenant creation and validation
   - Store tenant information in DynamoDB
   - Implement tenant-based access control

2. **User Management**
   - Add admin interface for creating users
   - Implement user invitation flow
   - Add role-based access control (admin, user, viewer)

3. **Error Handling**
   - Add better error messages for users
   - Implement retry logic for failed operations
   - Add loading states for all async operations

4. **Testing**
   - Add unit tests for frontend components
   - Add integration tests for API endpoints
   - Add end-to-end tests for critical user flows

5. **Monitoring**
   - Add CloudWatch dashboards for API metrics
   - Set up alarms for errors and performance issues
   - Implement user activity logging

## Environment Configuration

The frontend uses these environment variables (in `frontend/.env`):

```bash
REACT_APP_API_GATEWAY_URL=https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev
REACT_APP_USER_POOL_ID=us-east-1_WcelaDusa
REACT_APP_USER_POOL_CLIENT_ID=3ttm9u94lgpjqlp8uvmns6a69h
REACT_APP_IDENTITY_POOL_ID=us-east-1:d24b75c1-241d-4438-aba7-30277e1bcfe3
```

**Note**: The `.env` file is in `.gitignore` and should not be committed to the repository.

## Support

For issues or questions:
1. Check CloudWatch logs for Lambda functions
2. Review API Gateway execution logs
3. Check browser console for frontend errors
4. Contact the platform team for infrastructure issues
