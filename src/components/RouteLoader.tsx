import { useTranslation } from '../shared/useTranslation';

export default function RouteLoader() {
    const { t } = useTranslation();
    return <div className="route-loader" role="status">{t('page.loading')}</div>;
}
