// Mock for aws-amplify/auth used by frontend claimApi.ts
// This allows tests that import claimApi to run without the aws-amplify package
export const fetchAuthSession = jest.fn().mockResolvedValue({
  tokens: {
    idToken: { toString: () => 'mock-id-token' },
  },
});

export const getCurrentUser = jest.fn().mockResolvedValue({
  username: 'mock-user',
  userId: 'mock-user-id',
});
