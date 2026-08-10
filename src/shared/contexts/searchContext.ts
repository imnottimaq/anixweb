import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';

export type SearchScope =
    | { type: 'releases' }
    | { type: 'profiles' }
    | { type: 'favorites' }
    | { type: 'history' }
    | { type: 'collections' }
    | { type: 'profileList'; list: 1 | 2 | 3 | 4 | 5 };

export const SearchContext = createContext<{
    searchScope: SearchScope;
    setSearchScope: Dispatch<SetStateAction<SearchScope>>;
} | null>(null);

export function useSearchScope() {
    const context = useContext(SearchContext);
    if (!context) throw new Error('useSearchScope failed');
    return context;
}
