import { useQuery } from '@tanstack/react-query';
import { fetchAwairData } from '../services/awairService';

export function useAwairData() {
  const {
    data: queryData,
    isLoading: loading,
    error,
    refetch: refresh,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['awair-data'],
    queryFn: fetchAwairData,
  });

  const data = queryData?.records || [];
  const summary = queryData?.summary || null;
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return {
    data,
    summary,
    loading,
    error: error ? (error as Error).message : null,
    lastUpdated,
    refresh,
  };
}
