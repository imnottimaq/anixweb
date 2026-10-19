import React, { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { parseShikimoriId, searchShikimoriCatalog } from '../shared/shikimoriCatalog';
import { useApi } from '../shared/apiClient';
import { useUser } from '../shared/contexts/userContext';
import { getRoomParticipant } from '../shared/roomParticipant';
import { useTranslation } from '../shared/useTranslation';
import type { TranslationKey } from '../shared/i18n';
import styles from './AnimeListTransfer.module.css';
import {
    type AnixartListStatusId,
    type ExportListOption,
    type ExportProgress,
    type ExportPreviewItem,
    type ExportFormat,
    type ImportOptions,
    type ImportPreviewItem,
    type ImportProgress,
    type ParsedAnimeItem,
    fetchExportBookmarks,
    serializeToMalXml,
    serializeToShikimoriJson,
    triggerXmlDownload,
    triggerJsonDownload,
    parseMalXml,
    parseShikimoriJson,
    JsonParseError,
    matchItem,
    runImport,
    searchCandidates,
    XmlSecurityError,
    XmlParseError,
    MAX_XML_FILE_BYTES,
    mapAnixartStatusToMal,
} from '../shared/listTransfer';
import type { Anime } from '../shared/types/api';

type TabMode = 'export' | 'import';
type PreviewFilter = 'all' | 'matched' | 'unmatched' | 'conflicts';

const DEFAULT_EXPORT_OPTIONS: ExportListOption[] = [
    { id: 'watching', statusId: 1, labelKey: 'status.watching', enabled: true },
    { id: 'planned', statusId: 2, labelKey: 'status.planned', enabled: true },
    { id: 'completed', statusId: 3, labelKey: 'status.watched', enabled: true },
    { id: 'onHold', statusId: 4, labelKey: 'status.hold_on', enabled: true },
    { id: 'dropped', statusId: 5, labelKey: 'status.dropped', enabled: true },
];

export const AnimeListTransfer: React.FC = () => {
    const { userToken, userId } = useUser();
    return <TransferSession key={`${userId}:${userToken}`} />;
};

const TransferSession: React.FC = () => {
    const { t } = useTranslation();
    const api = useApi();
    const { userToken, userId } = useUser();
    const isUserLoggedIn = Boolean(userToken && userId && userId > 0);
    const userProfile = isUserLoggedIn ? getRoomParticipant(userId) : null;

    // Component lifecycle and job protection
    const isMountedRef = useRef(true);
    const exportJobIdRef = useRef(0);
    const importJobIdRef = useRef(0);
    const readerRef = useRef<FileReader | null>(null);
    const suggestionControllers = useRef(new Map<string, AbortController>());
    const importSearchGeneration = useRef(0);
    const [activeTab, setActiveTab] = useState<TabMode>('export');

    // ==========================================
    // EXPORT STATE
    // ==========================================
    const [exportFormat, setExportFormat] = useState<ExportFormat>('xml');
    const [exportOptions, setExportOptions] = useState<ExportListOption[]>(DEFAULT_EXPORT_OPTIONS);
    const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
    const [exportResult, setExportResult] = useState<{ success: boolean; message: string } | null>(null);
    const [exportItems, setExportItems] = useState<ExportPreviewItem[] | null>(null);
    const [isFetchingExport, setIsFetchingExport] = useState(false);
    const exportAbortController = useRef<AbortController | null>(null);

    // ==========================================
    // IMPORT STATE
    // ==========================================
    const [isDragActive, setIsDragActive] = useState(false);
    const [isMatching, setIsMatching] = useState(false);
    const [matchingProgress, setMatchingProgress] = useState<{ current: number; total: number } | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const [previewItems, setPreviewItems] = useState<ImportPreviewItem[] | null>(null);
    const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all');
    const [importOptions, setImportOptions] = useState<ImportOptions>({
        applyStatus: true,
        applyScore: true,
        overwriteStatusOnConflict: false,
    });
    const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
    const importAbortController = useRef<AbortController | null>(null);

    // Manual Resolution State for Import
    const [resolvingImportItemId, setResolvingImportItemId] = useState<string | null>(null);
    const [importResolutionQuery, setImportResolutionQuery] = useState('');
    const [importResolutionCandidates, setImportResolutionCandidates] = useState<Anime[]>([]);
    const [isSearchingImportCandidates, setIsSearchingImportCandidates] = useState(false);

    // ==========================================
    // EXPORT HANDLERS
    // ==========================================
    const toggleExportOption = (id: string) => {
        setExportOptions(prev =>
            prev.map(opt => (opt.id === id ? { ...opt, enabled: !opt.enabled } : opt))
        );
    };

    const handleFetchExportLists = async () => {
        if (!isUserLoggedIn) return;

        setExportResult(null);
        setIsFetchingExport(true);
        setExportProgress({
            currentListLabel: '',
            currentPage: 0,
            fetchedCount: 0,
            isExporting: true,
            error: null,
        });
        exportAbortController.current?.abort();
        for (const controller of suggestionControllers.current.values()) controller.abort();
        suggestionControllers.current.clear();
        setExportItems(null);
        exportAbortController.current = new AbortController();
        const signal = exportAbortController.current.signal;
        const currentJobId = ++exportJobIdRef.current;

        try {
            const collected = await fetchExportBookmarks(api, exportOptions, signal);
            if (!isMountedRef.current || exportJobIdRef.current !== currentJobId) return;
            if (signal.aborted) throw new DOMException('Export aborted', 'AbortError');
            setExportItems(collected);
        } catch {
            if (!isMountedRef.current || exportJobIdRef.current !== currentJobId) return;
            if (signal.aborted) {
                setExportResult({ success: false, message: t('roadmap.imports.exportCanceled') });
            } else {
                setExportResult({ success: false, message: t('roadmap.imports.exportError') });
            }
        } finally {
            if (isMountedRef.current && exportJobIdRef.current === currentJobId) {
                setIsFetchingExport(false);
                setExportProgress(null);
            }
        }
    };

    const handleExportExternalIdChange = (itemId: string, value: string) => {
        setExportItems(prev =>
            prev
                ? prev.map(item => {
                      if (item.id !== itemId) return item;
                      const numericId = parseShikimoriId(value);
                      return {
                          ...item,
                          manualInput: value,
                          externalId: numericId && numericId > 0 ? numericId : undefined,
                      };
                  })
                : null
        );
    };

    const handleExportSearchSuggestions = async (item: ExportPreviewItem) => {
        const query = item.anime.title_original || item.anime.title_ru || '';
        if (!query.trim()) return;

        setExportItems(prev =>
            prev ? prev.map(i => (i.id === item.id ? { ...i, isSearching: true } : i)) : null
        );

        suggestionControllers.current.get(item.id)?.abort();
        const controller = new AbortController();
        suggestionControllers.current.set(item.id, controller);
        const jobId = exportJobIdRef.current;
        try {
            const suggestions = await searchShikimoriCatalog(query, controller.signal);
            if (!isMountedRef.current || controller.signal.aborted || exportJobIdRef.current !== jobId) return;
            setExportItems(prev => prev ? prev.map(i => i.id === item.id ? { ...i, suggestions } : i) : null);
            if (!suggestions.length) setExportResult({ success: false, message: t('roadmap.imports.noCandidates') });
        } catch (error) {
            if (isMountedRef.current && !controller.signal.aborted && exportJobIdRef.current === jobId) {
                setExportResult({ success: false, message: error instanceof Error ? error.message : t('roadmap.imports.exportError') });
            }
        } finally {
            if (isMountedRef.current && exportJobIdRef.current === jobId) {
                setExportItems(prev => prev ? prev.map(i => i.id === item.id ? { ...i, isSearching: false } : i) : null);
            }
        }
    };

    const handleSelectExportSuggestion = (itemId: string, candidateId: number) => {
        setExportItems(prev =>
            prev
                ? prev.map(i =>
                      i.id === itemId
                          ? { ...i, externalId: candidateId, manualInput: String(candidateId), suggestions: undefined }
                          : i
                  )
                : null
        );
    };

    const toggleExportItemSkip = (itemId: string) => {
        setExportItems(prev =>
            prev ? prev.map(i => (i.id === itemId ? { ...i, isSkipped: !i.isSkipped } : i)) : null
        );
    };

    const handleExecuteExport = () => {
        if (!isUserLoggedIn || !exportItems || isFetchingExport) return;

        const activeEntries = exportItems.filter(i => !i.isSkipped);
        const unresolved = activeEntries.filter(i => !Number.isSafeInteger(i.externalId) || (i.externalId ?? 0) <= 0);

        if (unresolved.length > 0) {
            setExportResult({
                success: false,
                message: t('roadmap.imports.exportRequiresResolution'),
            });
            return;
        }

        try {
            const entries = activeEntries.map(i => ({
                anime: i.anime,
                status: i.status,
                externalId: i.externalId!,
            }));

            const profileInfo = userProfile ? { id: userProfile.profileId ?? userId, login: userProfile.login } : undefined;

            if (exportFormat === 'json') {
                const json = serializeToShikimoriJson({ profile: profileInfo, entries });
                triggerJsonDownload(json, `anixart_${userProfile?.login || 'user'}_shikimori_list.json`);
                setExportResult({ success: true, message: t('roadmap.imports.exportSuccessJson') });
            } else {
                const xml = serializeToMalXml({ profile: profileInfo, entries });
                triggerXmlDownload(xml, `anixart_${userProfile?.login || 'user'}_mal_list.xml`);
                setExportResult({ success: true, message: t('roadmap.imports.exportSuccess') });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('roadmap.imports.exportError');
            setExportResult({ success: false, message });
        }
    };

    const handleCancelExport = () => {
        exportAbortController.current?.abort();
        ++exportJobIdRef.current;
        setIsFetchingExport(false);
        setExportProgress(null);
        setExportItems(null);
        setExportResult({ success: false, message: t('roadmap.imports.exportCanceled') });
    };

    // ==========================================
    // IMPORT HANDLERS
    // ==========================================
    const processFile = useCallback(async (file: File) => {
        if (!isUserLoggedIn) return;
        importAbortController.current?.abort();
        readerRef.current?.abort();
        const currentJobId = ++importJobIdRef.current;
        ++importSearchGeneration.current;
        setIsMatching(false);
        setMatchingProgress(null);
        setImportError(null);
        setPreviewItems(null);
        setImportProgress(null);

        if (file.size > MAX_XML_FILE_BYTES) {
            setImportError(t('roadmap.imports.fileSizeError'));
            return;
        }

        const reader = new FileReader();
        readerRef.current = reader;

        reader.onload = async event => {
            if (!isMountedRef.current || importJobIdRef.current !== currentJobId) return;

            const content = event.target?.result as string;
            if (!content) {
                setImportError(t('roadmap.imports.xmlParseError'));
                return;
            }

            let parsed: ParsedAnimeItem[];
            const isJson = file.name.toLowerCase().endsWith('.json') || content.trim().startsWith('[') || content.trim().startsWith('{');

            try {
                if (isJson) {
                    parsed = parseShikimoriJson(content);
                } else {
                    parsed = parseMalXml(content);
                }
            } catch (err) {
                if (err instanceof XmlSecurityError) {
                    setImportError(t('roadmap.imports.xmlSecurityError'));
                } else if (err instanceof XmlParseError || err instanceof JsonParseError) {
                    setImportError(`${t('roadmap.imports.xmlParseError')} ${err.message}`);
                } else {
                    setImportError(t('roadmap.imports.xmlParseError'));
                }
                return;
            }

            if (parsed.length === 0) {
                setImportError(t('roadmap.imports.noAnimeFound'));
                return;
            }

            // Begin matching with Anixart catalog
            setIsMatching(true);
            setMatchingProgress({ current: 0, total: parsed.length });

            try {
                const matched: ImportPreviewItem[] = [];
                for (let i = 0; i < parsed.length; i++) {
                    if (!isMountedRef.current || importJobIdRef.current !== currentJobId) return;
                    const res = await matchItem(parsed[i], api);
                    if (!isMountedRef.current || importJobIdRef.current !== currentJobId) return;
                    matched.push(res);
                    setMatchingProgress({ current: i + 1, total: parsed.length });
                }
                if (isMountedRef.current && importJobIdRef.current === currentJobId) setPreviewItems(matched);
            } catch (error) {
                if (isMountedRef.current && importJobIdRef.current === currentJobId) setImportError(error instanceof Error ? error.message : t('roadmap.imports.importError'));
            } finally {
                if (isMountedRef.current && importJobIdRef.current === currentJobId) {
                    setIsMatching(false);
                    setMatchingProgress(null);
                }
            }
        };

        reader.onerror = () => {
            if (isMountedRef.current && importJobIdRef.current === currentJobId) {
                setImportError(t('roadmap.imports.xmlParseError'));
            }
        };

        reader.readAsText(file);
    }, [api, t, isUserLoggedIn]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            void processFile(file);
        }
        e.target.value = '';
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragActive(false);
        const file = e.dataTransfer.files?.[0];
        if (file) {
            void processFile(file);
        }
    };

    const toggleImportItemSkip = (id: string) => {
        setPreviewItems(prev =>
            prev ? prev.map(item => (item.id === id ? { ...item, isSkipped: !item.isSkipped } : item)) : null
        );
    };

    // Candidate manual search for import
    const openManualResolve = (item: ImportPreviewItem) => {
        ++importSearchGeneration.current;
        setIsSearchingImportCandidates(false);
        setResolvingImportItemId(item.id);
        const query = item.titleRu || item.title;
        setImportResolutionQuery(query);
        setImportResolutionCandidates(item.resolutionCandidates);
    };

    const handleSearchCandidates = async () => {
        if (!importResolutionQuery.trim()) return;
        setIsSearchingImportCandidates(true);
        const generation = ++importSearchGeneration.current;
        const jobId = importJobIdRef.current;
        try {
            const candidates = await searchCandidates(importResolutionQuery, api);
            if (isMountedRef.current && generation === importSearchGeneration.current && jobId === importJobIdRef.current) {
                setImportResolutionCandidates(candidates);
            }
        } catch (error) {
            if (isMountedRef.current && generation === importSearchGeneration.current) setImportError(error instanceof Error ? error.message : t('roadmap.imports.importError'));
        } finally {
            if (isMountedRef.current && generation === importSearchGeneration.current) setIsSearchingImportCandidates(false);
        }
    };

    const selectImportCandidate = (itemId: string, release: Anime) => {
        setPreviewItems(prev =>
            prev
                ? prev.map(item => {
                      if (item.id !== itemId) return item;
                      const hasConflict = Boolean(
                          release.profile_list_status > 0 &&
                          item.anixartStatus !== null &&
                          release.profile_list_status !== item.anixartStatus
                      );
                      return {
                          ...item,
                          matchedRelease: release,
                          autoMatched: false,
                          matchState: 'matched',
                          hasConflict,
                          currentListStatus: release.profile_list_status,
                          currentVote: release.your_vote ?? release.my_vote ?? 0,
                          isSkipped: false,
                          completedStatus: undefined, completedScore: undefined, importResult: undefined, importError: undefined,
                      };
                  })
                : null
        );
        ++importSearchGeneration.current;
        setResolvingImportItemId(null);
        setImportResolutionCandidates([]);
    };

    // Check for conflicting duplicate destinations in preview
    const duplicateConflictMap = new Map<number, ImportPreviewItem[]>();
    (previewItems || []).forEach(item => {
        if (!item.isSkipped && item.matchedRelease) {
            const list = duplicateConflictMap.get(item.matchedRelease.id) || [];
            list.push(item);
            duplicateConflictMap.set(item.matchedRelease.id, list);
        }
    });

    const duplicateConflicts = Array.from(duplicateConflictMap.entries()).filter(([, list]) => {
        if (list.length <= 1) return false;
        const first = list[0];
        return list.some(
            other =>
                (importOptions.applyStatus && other.anixartStatus !== first.anixartStatus) ||
                (importOptions.applyScore && other.anixartScore !== first.anixartScore)
        );
    });

    const handleConfirmImport = async (itemsToImport?: ImportPreviewItem[]) => {
        const targetItems = itemsToImport || previewItems;
        if (!isUserLoggedIn || !targetItems || importProgress?.isImporting) return;

        importAbortController.current?.abort();
        importAbortController.current = new AbortController();
        const currentJobId = ++importJobIdRef.current;

        try {
            await runImport({
                items: targetItems,
                options: importOptions,
                api,
                signal: importAbortController.current.signal,
                onProgress: p => {
                    if (isMountedRef.current && importJobIdRef.current === currentJobId) {
                        setImportProgress(p);
                    }
                },
            });
        } catch (error) {
            if (isMountedRef.current && importJobIdRef.current === currentJobId) {
                setImportProgress({
                    total: targetItems.length,
                    processed: 0,
                    succeeded: 0,
                    failed: targetItems.length,
                    isImporting: false,
                    isCancelled: false,
                    errors: [{ id: 'fatal', title: 'Fatal error', error: error instanceof Error ? error.message : 'Import failed' }],
                });
            }
        }
    };

    const handleRetryFailed = () => {
        if (!previewItems) return;
        const failedItems = previewItems.filter(item => item.importResult === 'failed');
        if (failedItems.length > 0) {
            void handleConfirmImport(failedItems);
        }
    };

    const handleCancelImport = () => {
        importAbortController.current?.abort();
    };

    const handleResetImport = () => {
        importAbortController.current?.abort();
        readerRef.current?.abort();
        ++importJobIdRef.current;
        ++importSearchGeneration.current;
        setIsMatching(false);
        setMatchingProgress(null);
        setPreviewItems(null);
        setImportProgress(null);
        setImportError(null);
        setResolvingImportItemId(null);
    };

    // Filter preview items
    const filteredPreviewItems = (previewItems || []).filter(item => {
        if (previewFilter === 'matched') return item.matchState === 'matched';
        if (previewFilter === 'unmatched') return item.matchState === 'unmatched' || item.matchState === 'candidate';
        if (previewFilter === 'conflicts') return item.hasConflict;
        return true;
    });

    const matchedCount = (previewItems || []).filter(item => item.matchState === 'matched').length;
    const unmatchedCount = (previewItems || []).filter(
        item => item.matchState === 'unmatched' || item.matchState === 'candidate'
    ).length;
    const conflictsCount = (previewItems || []).filter(item => item.hasConflict).length;
    const actionableCount = (previewItems || []).filter(
        item => !item.isSkipped && item.matchedRelease && ((importOptions.applyStatus && item.anixartStatus !== null) || (importOptions.applyScore && item.anixartScore > 0))
    ).length;

    // Export counts
    const exportActiveCount = (exportItems || []).filter(i => !i.isSkipped).length;
    const exportResolvedCount = (exportItems || []).filter(i => !i.isSkipped && Number.isSafeInteger(i.externalId) && (i.externalId ?? 0) > 0).length;
    const exportUnresolvedCount = exportActiveCount - exportResolvedCount;

    useLayoutEffect(() => {
        isMountedRef.current = true;
        const currentSuggestionControllers = suggestionControllers.current;
        return () => {
            isMountedRef.current = false;
            exportAbortController.current?.abort();
            importAbortController.current?.abort();
            readerRef.current?.abort();
            for (const controller of currentSuggestionControllers.values()) controller.abort();
        };
    }, []);

    return (
        <section className={styles.container} aria-label={t('roadmap.imports.title')}>
            <div className={styles.header}>
                <h2 className={styles.title}>{t('roadmap.imports.title')}</h2>
                <p className={styles.description}>{t('roadmap.imports.description')}</p>
                <p className={styles.sectionText}>{t('roadmap.imports.transferLimits')}</p>
            </div>

            {!userToken && (
                <div className={styles.authWarning} role="alert">
                    <span>{t('roadmap.imports.loginRequired')}</span>
                    <Link to="/account/login" className={styles.loginLink}>
                        {t('settings.accountSync.loginButton')}
                    </Link>
                </div>
            )}

            <div className={styles.tabs} role="tablist">
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'export'}
                    className={`${styles.tabButton} ${activeTab === 'export' ? styles.active : ''}`}
                    onClick={() => setActiveTab('export')}
                    disabled={!userToken || Boolean(isFetchingExport) || Boolean(importProgress?.isImporting)}
                >
                    {t('roadmap.imports.tabExport')}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'import'}
                    className={`${styles.tabButton} ${activeTab === 'import' ? styles.active : ''}`}
                    onClick={() => setActiveTab('import')}
                    disabled={!userToken || Boolean(isFetchingExport) || Boolean(importProgress?.isImporting)}
                >
                    {t('roadmap.imports.tabImport')}
                </button>
            </div>

            {/* ==================================================== */}
            {/* EXPORT TAB */}
            {/* ==================================================== */}
            {activeTab === 'export' && (
                <div className={styles.section}>
                    <h3 className={styles.sectionHeading}>{t('roadmap.imports.exportTitle')}</h3>
                    <p className={styles.sectionText}>{t('roadmap.imports.exportDesc')}</p>

                    {/* Format Selector */}
                    <div className={styles.formatSelector}>
                        <span style={{ fontWeight: 600 }}>{t('roadmap.imports.formatLabel')}:</span>
                        <label className={styles.formatOption}>
                            <input
                                type="radio"
                                name="exportFormat"
                                value="xml"
                                checked={exportFormat === 'xml'}
                                onChange={() => setExportFormat('xml')}
                            />
                            {t('roadmap.imports.formatXml')}
                        </label>
                        <label className={styles.formatOption}>
                            <input
                                type="radio"
                                name="exportFormat"
                                value="json"
                                checked={exportFormat === 'json'}
                                onChange={() => setExportFormat('json')}
                            />
                            {t('roadmap.imports.formatJson')}
                        </label>
                    </div>

                    {/* Step 1: List selection & fetch */}
                    {!exportItems && (
                        <>
                            <div className={styles.checkboxGrid}>
                                {exportOptions.map(opt => (
                                    <label key={opt.id} className={styles.checkboxLabel}>
                                        <input
                                            type="checkbox"
                                            checked={opt.enabled}
                                            onChange={() => toggleExportOption(opt.id)}
                                            disabled={isFetchingExport}
                                        />
                                        {t(opt.labelKey as TranslationKey)}
                                    </label>
                                ))}
                            </div>

                            {isFetchingExport && (
                                <div className={styles.progressBarContainer} role="status">
                                    <div className={styles.progressBarMeta}>
                                        <span>
                                            {t('roadmap.imports.fetching')}
                                            {exportProgress && exportProgress.fetchedCount > 0 ? ` (${exportProgress.fetchedCount})` : ''}
                                        </span>
                                    </div>
                                    <div className={styles.progressBarTrack}>
                                        <div className={styles.progressBarFill} style={{ width: '100%' }} />
                                    </div>
                                </div>
                            )}

                            {exportResult && (
                                <div
                                    className={`${styles.alertBox} ${exportResult.success ? styles.alertSuccess : styles.alertError}`}
                                    role="alert"
                                >
                                    {exportResult.message}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 10 }}>
                                <button
                                    type="button"
                                    className={styles.primaryButton}
                                    onClick={handleFetchExportLists}
                                    disabled={!userToken || isFetchingExport}
                                >
                                    {t('roadmap.imports.exportButton')}
                                </button>
                                {isFetchingExport && (
                                    <button
                                        type="button"
                                        className={styles.dangerButton}
                                        onClick={handleCancelExport}
                                    >
                                        {t('roadmap.imports.cancelExport')}
                                    </button>
                                )}
                            </div>
                        </>
                    )}

                    {/* Step 2: External ID Resolution Table */}
                    {exportItems && (
                        <>
                            <div className={styles.progressBarMeta}>
                                <span>
                                    {t('roadmap.imports.exportResolvedCount', {
                                        resolved: exportResolvedCount,
                                        total: exportActiveCount,
                                        unresolved: exportUnresolvedCount,
                                    })}
                                </span>
                            </div>

                            {exportUnresolvedCount > 0 && (
                                <div className={`${styles.alertBox} ${styles.alertWarning}`} role="alert">
                                    {t('roadmap.imports.exportRequiresResolution')}
                                </div>
                            )}

                            {exportResult && (
                                <div
                                    className={`${styles.alertBox} ${exportResult.success ? styles.alertSuccess : styles.alertError}`}
                                    role="alert"
                                >
                                    {exportResult.message}
                                </div>
                            )}

                            <div className={styles.itemsList}>
                                {exportItems.map(item => {
                                    const hasExtId = Boolean(item.externalId && item.externalId > 0);
                                    return (
                                        <div
                                            key={item.id}
                                            className={`${styles.exportItemRow} ${!hasExtId ? styles.unmatched : ''} ${item.isSkipped ? styles.skipped : ''}`}
                                        >
                                            <div className={styles.itemSourceCol}>
                                                <span className={styles.itemTitle}>
                                                    {item.anime.title_ru || item.anime.title_original}
                                                </span>
                                                <span className={styles.itemSub}>
                                                    {item.anime.title_original} • Anixart ID: {item.anime.id}
                                                </span>
                                            </div>

                                            <div>
                                                <span className={`${styles.badge} ${styles.badgeStatus}`}>
                                                    {mapAnixartStatusToMal(item.status)}
                                                </span>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                {hasExtId ? (
                                                    <>
                                                        <span className={`${styles.badge} ${styles.badgeMatched}`}>
                                                            {item.manualInput && parseShikimoriId(item.manualInput) === item.externalId && !item.suggestions?.some(s => s.id === item.externalId)
                                                                ? t('roadmap.imports.verifiedManualBadge')
                                                                : t('roadmap.imports.resolvedBadge')}
                                                        </span>
                                                        <a
                                                            href={`https://shikimori.one/animes/${item.externalId}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={styles.shikimoriLink}
                                                        >
                                                            <span>{t('roadmap.imports.shikimoriLink', { id: item.externalId })}</span>
                                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}>
                                                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                                                            </svg>
                                                        </a>
                                                        <button
                                                            type="button"
                                                            className={styles.secondaryButton}
                                                            style={{ padding: '2px 8px', fontSize: 11 }}
                                                            onClick={() => handleExportExternalIdChange(item.id, '')}
                                                        >
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                                <path d="M18 6L6 18M6 6l12 12" />
                                                            </svg>
                                                        </button>
                                                    </>
                                                ) : (
                                                    <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                                                        <input
                                                            type="text"
                                                            placeholder={t('roadmap.imports.externalIdPlaceholder')}
                                                            value={item.manualInput ?? ''}
                                                            onChange={e => handleExportExternalIdChange(item.id, e.target.value)}
                                                            className={styles.searchInput}
                                                            style={{ maxWidth: 160 }}
                                                        />
                                                        <button
                                                            type="button"
                                                            className={styles.secondaryButton}
                                                            onClick={() => handleExportSearchSuggestions(item)}
                                                            disabled={item.isSearching}
                                                        >
                                                            {item.isSearching ? t('roadmap.imports.searching') : t('roadmap.imports.findShikimori')}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            <div>
                                                <button
                                                    type="button"
                                                    className={styles.secondaryButton}
                                                    onClick={() => toggleExportItemSkip(item.id)}
                                                >
                                                    {item.isSkipped ? t('roadmap.imports.unskip') : t('roadmap.imports.skip')}
                                                </button>
                                            </div>

                                            {/* Search suggestions dropdown for export */}
                                            {item.suggestions && item.suggestions.length > 0 && (
                                                <div className={styles.resolutionPanel}>
                                                    <span className={styles.itemSub} style={{ fontWeight: 600 }}>
                                                        {t('roadmap.imports.findShikimori')}:
                                                    </span>
                                                    <div className={styles.candidateList}>
                                                        {item.suggestions.map(sug => (
                                                            <div key={sug.id} className={styles.candidateItem}>
                                                                <span>
                                                                    <strong>{sug.titleRu || sug.title}</strong>
                                                                    {sug.year ? ` (${sug.year})` : ''} — ID: {sug.id}
                                                                </span>
                                                                <div style={{ display: 'flex', gap: 6 }}>
                                                                    <a
                                                                        href={sug.url}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className={styles.shikimoriLink}
                                                                    >
                                                                        <span>Shikimori</span>
                                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}>
                                                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                                                                        </svg>
                                                                    </a>
                                                                    <button
                                                                        type="button"
                                                                        className={styles.secondaryButton}
                                                                        onClick={() => handleSelectExportSuggestion(item.id, sug.id)}
                                                                    >
                                                                        {t('roadmap.imports.selectCandidate')}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className={styles.actionsFooter}>
                                <button
                                    type="button"
                                    className={styles.primaryButton}
                                    onClick={handleExecuteExport}
                                    disabled={!isUserLoggedIn || exportUnresolvedCount > 0 || exportActiveCount === 0}
                                >
                                    {t('roadmap.imports.exportButton')}
                                </button>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => {
                                        ++exportJobIdRef.current;
                                        for (const controller of suggestionControllers.current.values()) controller.abort();
                                        setExportItems(null);
                                        setExportResult(null);
                                    }}
                                >
                                    {t('roadmap.imports.reset')}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ==================================================== */}
            {/* IMPORT TAB */}
            {/* ==================================================== */}
            {activeTab === 'import' && (
                <div className={styles.section}>
                    <h3 className={styles.sectionHeading}>{t('roadmap.imports.importTitle')}</h3>
                    <p className={styles.sectionText}>{t('roadmap.imports.importDesc')}</p>

                    {importError && <div className={`${styles.alertBox} ${styles.alertError}`} role="alert">{importError}</div>}
                    {/* Step 1: Upload */}
                    {!previewItems && !isMatching && !importProgress && (
                        <>
                            <div
                                className={`${styles.dropzone} ${isDragActive ? styles.dragActive : ''}`}
                                onDragOver={e => {
                                    e.preventDefault();
                                    setIsDragActive(true);
                                }}
                                onDragLeave={() => setIsDragActive(false)}
                                onDrop={handleDrop}
                                onClick={() => document.getElementById('xml-file-input')?.click()}
                            >
                                <input
                                    id="xml-file-input"
                                    type="file"
                                    accept=".xml,text/xml,application/xml,.json,application/json"
                                    className={styles.fileInput}
                                    onChange={handleFileChange}
                                    disabled={!isUserLoggedIn}
                                />
                                <p>{t('roadmap.imports.dropzone')}</p>
                                <button type="button" className={styles.secondaryButton}>
                                    {t('roadmap.imports.selectFile')}
                                </button>
                            </div>


                        </>
                    )}

                    {/* Step 1.5: Matching with catalog */}
                    {isMatching && matchingProgress && (
                        <div className={styles.progressBarContainer} role="status">
                            <div className={styles.progressBarMeta}>
                                <span>
                                    {t('roadmap.imports.matchingProgress', {
                                        current: matchingProgress.current,
                                        total: matchingProgress.total,
                                    })}
                                </span>
                                <span>{Math.round((matchingProgress.current / matchingProgress.total) * 100)}%</span>
                            </div>
                            <div className={styles.progressBarTrack}>
                                <div
                                    className={styles.progressBarFill}
                                    style={{
                                        width: `${(matchingProgress.current / matchingProgress.total) * 100}%`,
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Step 2: Preview & Verification */}
                    {previewItems && !importProgress && (
                        <>
                            <div className={styles.previewOptions}>
                                <label className={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={importOptions.applyStatus}
                                        onChange={e =>
                                            setImportOptions(prev => ({ ...prev, applyStatus: e.target.checked }))
                                        }
                                    />
                                    {t('roadmap.imports.optApplyStatus')}
                                </label>
                                <label className={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={importOptions.applyScore}
                                        onChange={e =>
                                            setImportOptions(prev => ({ ...prev, applyScore: e.target.checked }))
                                        }
                                    />
                                    {t('roadmap.imports.optApplyScore')}
                                </label>
                                <label className={styles.checkboxLabel}>
                                    <input
                                        type="checkbox"
                                        checked={importOptions.overwriteStatusOnConflict}
                                        onChange={e =>
                                            setImportOptions(prev => ({
                                                ...prev,
                                                overwriteStatusOnConflict: e.target.checked,
                                            }))
                                        }
                                    />
                                    {t('roadmap.imports.optOverwrite')}
                                </label>
                            </div>

                            {duplicateConflicts.length > 0 && (
                                <div className={`${styles.alertBox} ${styles.alertError}`} role="alert">
                                    {duplicateConflicts.map(([destId]) => (
                                        <div key={destId}>
                                            {t('roadmap.imports.duplicateConflictWarning', { id: destId })}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className={styles.previewFilters}>
                                <button
                                    type="button"
                                    className={`${styles.filterButton} ${previewFilter === 'all' ? styles.active : ''}`}
                                    onClick={() => setPreviewFilter('all')}
                                >
                                    {t('roadmap.imports.filterAll', { count: previewItems.length })}
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.filterButton} ${previewFilter === 'matched' ? styles.active : ''}`}
                                    onClick={() => setPreviewFilter('matched')}
                                >
                                    {t('roadmap.imports.filterMatched', { count: matchedCount })}
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.filterButton} ${previewFilter === 'unmatched' ? styles.active : ''}`}
                                    onClick={() => setPreviewFilter('unmatched')}
                                >
                                    {t('roadmap.imports.filterUnmatched', { count: unmatchedCount })}
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.filterButton} ${previewFilter === 'conflicts' ? styles.active : ''}`}
                                    onClick={() => setPreviewFilter('conflicts')}
                                >
                                    {t('roadmap.imports.filterConflicts', { count: conflictsCount })}
                                </button>
                            </div>

                            <div className={styles.itemsList}>
                                {filteredPreviewItems.map(item => {
                                    const isResolving = resolvingImportItemId === item.id;
                                    return (
                                        <div
                                            key={item.id}
                                            className={`${styles.itemRow} ${item.hasConflict ? styles.conflict : ''} ${item.matchState === 'unmatched' || item.matchState === 'candidate' ? styles.unmatched : ''} ${item.isSkipped ? styles.skipped : ''}`}
                                        >
                                            <div className={styles.itemSourceCol}>
                                                <span className={styles.itemTitle}>{item.title}</span>
                                                <span className={styles.itemSub}>
                                                    {item.rawStatus || 'No status'} • Score {item.rawScore || '-'}
                                                </span>
                                            </div>

                                            <div className={styles.itemTargetCol}>
                                                {item.matchedRelease ? (
                                                    <>
                                                        <span className={styles.itemTitle}>
                                                            {item.matchedRelease.title_ru || item.matchedRelease.title_original}
                                                        </span>
                                                        <span className={`${styles.badge} ${styles.badgeMatched}`}>
                                                            {item.autoMatched ? t('roadmap.imports.autoMatchedBadge') : item.anixartId
                                                                ? t('roadmap.imports.matchedBadge')
                                                                : t('roadmap.imports.verifiedManualBadge')}
                                                        </span>
                                                        {item.hasConflict && (
                                                            <span className={styles.itemSub} style={{ color: '#f59e0b' }}>
                                                                {t('roadmap.imports.conflictNotice', {
                                                                    status: mapAnixartStatusToMal(
                                                                        item.currentListStatus as AnixartListStatusId
                                                                    ),
                                                                })}
                                                            </span>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span className={`${styles.badge} ${styles.badgeUnmatched}`}>
                                                        {t('roadmap.imports.unmatchedBadge')}
                                                    </span>
                                                )}
                                            </div>

                                            <div>
                                                {item.anixartStatus ? (
                                                    <span className={`${styles.badge} ${styles.badgeStatus}`}>
                                                        {mapAnixartStatusToMal(item.anixartStatus)}
                                                    </span>
                                                ) : (
                                                    '-'
                                                )}
                                            </div>

                                            <div>
                                                {item.anixartScore > 0 ? `${item.anixartScore} / 5` : '-'}
                                            </div>

                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button
                                                    type="button"
                                                    className={styles.secondaryButton}
                                                    onClick={() => openManualResolve(item)}
                                                >
                                                    {t(item.matchedRelease ? 'roadmap.imports.changeMatch' : 'roadmap.imports.resolve')}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.secondaryButton}
                                                    onClick={() => toggleImportItemSkip(item.id)}
                                                >
                                                    {item.isSkipped ? t('roadmap.imports.unskip') : t('roadmap.imports.skip')}
                                                </button>
                                            </div>

                                            {/* Manual resolution panel */}
                                            {isResolving && (
                                                <div className={styles.resolutionPanel}>
                                                    <div className={styles.searchBox}>
                                                        <input
                                                            type="text"
                                                            value={importResolutionQuery}
                                                            onChange={e => setImportResolutionQuery(e.target.value)}
                                                            placeholder={t('roadmap.imports.searchPlaceholder')}
                                                            className={styles.searchInput}
                                                        />
                                                        <button
                                                            type="button"
                                                            className={styles.secondaryButton}
                                                            onClick={handleSearchCandidates}
                                                            disabled={isSearchingImportCandidates}
                                                        >
                                                            {isSearchingImportCandidates
                                                                ? t('roadmap.imports.searching')
                                                                : t('roadmap.imports.resolve')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={styles.secondaryButton}
                                                            onClick={() => { ++importSearchGeneration.current; setResolvingImportItemId(null); setIsSearchingImportCandidates(false); }}
                                                        >
                                                            {t('roadmap.imports.cancelButton')}
                                                        </button>
                                                    </div>

                                                    <div className={styles.candidateList}>
                                                        {importResolutionCandidates.length === 0 && !isSearchingImportCandidates && (
                                                            <span className={styles.itemSub}>
                                                                {t('roadmap.imports.noCandidates')}
                                                            </span>
                                                        )}
                                                        {importResolutionCandidates.map(cand => (
                                                            <div key={cand.id} className={styles.candidateItem}>
                                                                <span>
                                                                    <strong>{cand.title_ru}</strong> (
                                                                    {cand.title_original || cand.year})
                                                                </span>
                                                                <button
                                                                  type="button"
                                                                  className={styles.secondaryButton}
                                                                  onClick={() => selectImportCandidate(item.id, cand)}
                                                                >
                                                                    {t('roadmap.imports.selectCandidate')}
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className={styles.actionsFooter}>
                                <button
                                    type="button"
                                    className={styles.primaryButton}
                                    onClick={() => handleConfirmImport()}
                                    disabled={!isUserLoggedIn || actionableCount === 0 || duplicateConflicts.length > 0}
                                >
                                    {t('roadmap.imports.confirmButton', { count: actionableCount })}
                                </button>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={handleResetImport}
                                >
                                    {t('roadmap.imports.reset')}
                                </button>
                            </div>
                        </>
                    )}

                    {/* Step 3 & 4: Progress & Results */}
                    {importProgress && (
                        <div className={styles.section}>
                            <div className={styles.progressBarContainer} role="status">
                                <div className={styles.progressBarMeta}>
                                    <span>
                                        {importProgress.isImporting
                                            ? t('roadmap.imports.importProgress', {
                                                  current: importProgress.processed,
                                                  total: importProgress.total,
                                              })
                                            : importProgress.isCancelled
                                            ? t('roadmap.imports.importCanceled')
                                            : importProgress.failed === 0 && !(importProgress.skipped ?? 0)
                                            ? t('roadmap.imports.importSuccess')
                                            : t('roadmap.imports.importPartial', {
                                                  succeeded: importProgress.succeeded,
                                                  failed: importProgress.failed,
                                              })}
                                    </span>
                                    <span>
                                        {importProgress.total > 0
                                            ? Math.round((importProgress.processed / importProgress.total) * 100)
                                            : 0}
                                        %
                                    </span>
                                </div>
                                <div className={styles.progressBarTrack}>
                                    <div
                                        className={styles.progressBarFill}
                                        style={{
                                            width: `${
                                                importProgress.total > 0
                                                    ? (importProgress.processed / importProgress.total) * 100
                                                    : 0
                                            }%`,
                                        }}
                                    />
                                </div>
                                {importProgress.currentItemTitle && (
                                    <span className={styles.itemSub}>
                                        {importProgress.currentItemTitle}
                                    </span>
                                )}
                            </div>

                            {!!importProgress.skipped && <p role="status">{t('roadmap.imports.importSkipped', { count: importProgress.skipped })}</p>}

                            {importProgress.errors.length > 0 && (
                                <div className={`${styles.alertBox} ${styles.alertError}`} role="alert">
                                    <p style={{ margin: '0 0 6px 0', fontWeight: 600 }}>
                                        {t('roadmap.imports.importError')} ({importProgress.errors.length}):
                                    </p>
                                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                                        {importProgress.errors.slice(0, 5).map((err, idx) => (
                                            <li key={idx}>
                                                {err.title}: {err.error}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className={styles.actionsFooter}>
                                {importProgress.isImporting ? (
                                    <button
                                        type="button"
                                        className={styles.dangerButton}
                                        onClick={handleCancelImport}
                                    >
                                        {t('roadmap.imports.cancelImport')}
                                    </button>
                                ) : (
                                    <>
                                        {importProgress.failed > 0 && (
                                            <button
                                                type="button"
                                                className={styles.primaryButton}
                                                onClick={handleRetryFailed}
                                            >
                                                {t('roadmap.imports.retryFailed', { count: importProgress.failed })}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            onClick={handleResetImport}
                                        >
                                            {t('roadmap.imports.reset')}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};

export default AnimeListTransfer;
