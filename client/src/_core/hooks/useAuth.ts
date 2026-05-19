export function useAuth() {
  return {
    user: {
      id: "local-user",
      name: "Local User",
    },
    isLoading: false,
    isAuthenticated: true,
  };
}