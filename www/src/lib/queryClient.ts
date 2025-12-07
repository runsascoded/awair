import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes (data is "fresh" for 2 minutes)
      // Note: refetchInterval removed - smart polling handles this with Lambda-synced timing
      refetchOnWindowFocus: false, // Smart polling handles tab visibility
      retry: 1, // Retry failed requests once (more retries = long spinner on nav)
      retryDelay: 1000, // 1 second delay before retry
    },
  },
})
