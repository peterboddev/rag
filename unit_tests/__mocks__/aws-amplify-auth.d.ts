// Type declarations for aws-amplify/auth mock
// This satisfies TypeScript compilation when claimApi.ts is imported in tests
declare module 'aws-amplify/auth' {
  export function fetchAuthSession(options?: { forceRefresh?: boolean }): Promise<{
    tokens?: {
      idToken?: { toString(): string };
      accessToken?: { toString(): string };
    };
    credentials?: unknown;
  }>;

  export function getCurrentUser(): Promise<{
    username: string;
    userId: string;
  }>;
}
