import { Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import RootLayout from './RootLayout';
import RouteLoader from '../components/RouteLoader';

import { HomepageScreen, OverviewScreen, FavoritesScreen, ReleaseScreen, PlayerScreen, FranchiseScreen,
    AccountScreen, EditAccountScreen, LoginScreen, RecoverScreen, NewAccountScreen, RandomAnime, SettingsScreen,
    NotificationsScreen, NotificationSettingsScreen, ReleaseNotificationSettingsScreen, WatchRoomScreen, FilterSearchScreen,
    CollectionScreen, FriendsPage
 } from './components';
import CollectionsScreen from '../pages/CollectionsScreen';

function lazyPage(page: ReactNode) {
    return <Suspense fallback={<RouteLoader />}>{page}</Suspense>;
}

const basename = import.meta.env.BASE_URL === '/'
    ? undefined
    : import.meta.env.BASE_URL.replace(/\/$/, '');

export const router = createBrowserRouter([
{
    path: '/',
    element: <RootLayout />,
    children: [
    { index: true, element: lazyPage(<HomepageScreen />) },
    { path: 'overview', element: lazyPage(<OverviewScreen />) },
    { path: 'filter', element: lazyPage(<FilterSearchScreen />) },
    { path: 'favorites', element: lazyPage(<FavoritesScreen />) },
    { path: 'favorites/:profileId', element: lazyPage(<FavoritesScreen />) },
    { path: 'anime/:id', element: lazyPage(<ReleaseScreen />) },
    { path: 'anime/:id/watch', element: lazyPage(<PlayerScreen />) },
    { path: 'franchise/:id', element: lazyPage(<FranchiseScreen />) },
    { path: 'account', element: lazyPage(<AccountScreen />) },
    { path: 'friends', element: lazyPage(<FriendsPage />) },
    { path: 'friends/:profileId', element: lazyPage(<FriendsPage />) },
    { path: 'account/edit', element: lazyPage(<EditAccountScreen />) },
    { path: 'account/:id', element: lazyPage(<AccountScreen />)  },
    { path: 'account/login', element: lazyPage(<LoginScreen />) },
    { path: 'account/recover', element: lazyPage(<RecoverScreen />) },
    { path: 'account/create', element: lazyPage(<NewAccountScreen />) },
    { path: 'random', element: lazyPage(<RandomAnime />) },
    { path: 'settings', element: lazyPage(<SettingsScreen />) },
    { path: 'notifications', element: lazyPage(<NotificationsScreen />) },
    { path: 'notifications/settings', element: lazyPage(<NotificationSettingsScreen />) },
    { path: 'notifications/releases', element: lazyPage(<ReleaseNotificationSettingsScreen />) },
    { path: 'together', element: lazyPage(<WatchRoomScreen />) },
    { path: 'together/:roomId', element: lazyPage(<WatchRoomScreen />) },
    { path: 'collections', element: lazyPage(<CollectionsScreen />) },
    { path: 'collection/:id', element: lazyPage(<CollectionScreen />)}
    ],
},
], { basename });
