import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { Amplify } from 'aws-amplify';

// Configure Amplify with Cognito (User Pool only, no Identity Pool)
// The Identity Pool doesn't have IAM roles configured, causing errors
// We only need User Pool JWT tokens for API Gateway authentication
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.REACT_APP_USER_POOL_ID || 'us-east-1_WcelaDusa',
      userPoolClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID || '3ttm9u94lgpjqlp8uvmns6a69h',
      loginWith: {
        email: true,
      },
      signUpVerificationMethod: 'code',
      userAttributes: {
        email: {
          required: true,
        },
      },
      allowGuestAccess: false,
      passwordFormat: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: true,
      },
    },
  },
} as any); // Type assertion to bypass identityPoolId requirement

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);