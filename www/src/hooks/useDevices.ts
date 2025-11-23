import { useQuery } from '@tanstack/react-query'
import { fetchDevices } from '../services/awairService'

export function useDevices() {
  const {
    data: devices = [],
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: ['devices'],
    queryFn: fetchDevices,
    staleTime: 3_600_000, // 1 hour
  })

  return {
    devices,
    loading,
    error: error ? (error as Error).message : null,
  }
}
