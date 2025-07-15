import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes (data is "fresh" for 2 minutes)
      refetchInterval: 3 * 60 * 1000, // Auto-refetch every 3 minutes
      refetchOnWindowFocus: true, // Refetch when user comes back to tab
      retry: 3, // Retry failed requests 3 times
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    },
  },
})
