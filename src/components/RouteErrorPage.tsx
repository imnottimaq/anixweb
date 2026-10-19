import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { PageHeader, PageLayout } from './PageLayout';
import PageState from './PageState';
import { useTranslation } from '../shared/useTranslation';

export default function RouteErrorPage({ notFound = false }: { notFound?: boolean }) {
    const error = useRouteError();
    const { t } = useTranslation();
    const missing = notFound || (isRouteErrorResponse(error) && error.status === 404);

    return <PageLayout>
        <PageHeader title={t(missing ? 'page.notFoundTitle' : 'page.routeErrorTitle')} />
        <PageState
            status={missing ? 'empty' : 'error'}
            message={t(missing ? 'page.notFound' : 'page.routeError')}
            onRetry={missing ? undefined : () => window.location.reload()}
        />
        <Link to="/">{t('nav.home')}</Link>
    </PageLayout>;
}
