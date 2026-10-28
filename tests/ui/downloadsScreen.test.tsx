import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DownloadsScreen from '../../src/pages/DownloadsScreen';
import * as opfsStorage from '../../src/shared/storage/opfsStorage';
import * as downloadModule from '../../src/shared/player/download';
import { SettingsContext } from '../../src/shared/contexts/settingsContext';
import { defaultAppSettings } from '../../src/shared/types/settings';

const mockEpisodes: opfsStorage.StoredEpisodeMetadata[] = [
    {
        id: 'dl_1_ep1_720',
        releaseId: 1,
        releaseTitle: 'Attack on Titan',
        episodeNumber: 1,
        episodeName: 'To You, in 2000 Years',
        quality: '720',
        filename: 'AoT_01_720p.mp4',
        fileSize: 104857600, // 100 MB
        downloadedAt: Date.now() - 3600000,
    },
    {
        id: 'dl_2_ep5_1080',
        releaseId: 2,
        releaseTitle: 'Death Note',
        episodeNumber: 5,
        episodeName: 'Tactics',
        quality: '1080',
        filename: 'Death_Note_05_1080p.mp4',
        fileSize: 209715200, // 200 MB
        downloadedAt: Date.now() - 1800000,
    },
];

function renderDownloads() {
    return render(
        <MemoryRouter>
            <SettingsContext.Provider value={{ settings: defaultAppSettings, setSettings: vi.fn() }}>
                <DownloadsScreen />
            </SettingsContext.Provider>
        </MemoryRouter>
    );
}

describe('DownloadsScreen UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('displays empty state when no episodes are stored', async () => {
        vi.spyOn(opfsStorage, 'getDownloadedEpisodes').mockResolvedValue([]);
        vi.spyOn(opfsStorage, 'getStorageEstimate').mockResolvedValue({
            usage: 0,
            quota: 10737418240,
            formattedUsage: '0 B',
            formattedQuota: '10 GB',
            percentUsed: 0,
        });

        renderDownloads();

        await waitFor(() => {
            expect(screen.getByText('Нет загруженных серий')).toBeInTheDocument();
        });

        expect(screen.getByRole('link', { name: /каталог/i })).toHaveAttribute('href', '/overview');
    });

    it('renders downloaded episode cards with title, episode number and quality', async () => {
        vi.spyOn(opfsStorage, 'getDownloadedEpisodes').mockResolvedValue(mockEpisodes);
        vi.spyOn(opfsStorage, 'getStorageEstimate').mockResolvedValue({
            usage: 314572800,
            quota: 10737418240,
            formattedUsage: '300 MB',
            formattedQuota: '10 GB',
            percentUsed: 2.9,
        });

        renderDownloads();

        await waitFor(() => {
            expect(screen.getByText('Attack on Titan')).toBeInTheDocument();
            expect(screen.getByText('Death Note')).toBeInTheDocument();
        });

        expect(screen.getByText(/1 серия/i)).toBeInTheDocument();
        expect(screen.getByText(/5 серия/i)).toBeInTheDocument();
        expect(screen.getByText('720p')).toBeInTheDocument();
        expect(screen.getByText('1080p')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Удалить все' })).toBeInTheDocument();
    });

    it('filters episodes based on search input', async () => {
        vi.spyOn(opfsStorage, 'getDownloadedEpisodes').mockResolvedValue(mockEpisodes);
        vi.spyOn(opfsStorage, 'getStorageEstimate').mockResolvedValue({
            usage: 314572800,
            quota: 10737418240,
            formattedUsage: '300 MB',
            formattedQuota: '10 GB',
            percentUsed: 2.9,
        });

        renderDownloads();

        await waitFor(() => {
            expect(screen.getByText('Attack on Titan')).toBeInTheDocument();
        });

        const searchInput = screen.getByRole('searchbox');
        fireEvent.change(searchInput, { target: { value: 'Death' } });

        expect(screen.queryByText('Attack on Titan')).not.toBeInTheDocument();
        expect(screen.getByText('Death Note')).toBeInTheDocument();

        // Clear search
        const clearBtn = screen.getByRole('button', { name: /очистить/i });
        fireEvent.click(clearBtn);

        expect(screen.getByText('Attack on Titan')).toBeInTheDocument();
        expect(screen.getByText('Death Note')).toBeInTheDocument();
    });

    it('handles delete of a single episode', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const deleteSpy = vi.spyOn(opfsStorage, 'deleteDownloadedEpisode').mockResolvedValue(true);
        vi.spyOn(opfsStorage, 'getDownloadedEpisodes')
            .mockResolvedValueOnce(mockEpisodes)
            .mockResolvedValueOnce([mockEpisodes[1]]);
        vi.spyOn(opfsStorage, 'getStorageEstimate').mockResolvedValue({
            usage: 209715200,
            quota: 10737418240,
            formattedUsage: '200 MB',
            formattedQuota: '10 GB',
            percentUsed: 1.9,
        });

        renderDownloads();

        await waitFor(() => {
            expect(screen.getByText('Attack on Titan')).toBeInTheDocument();
        });

        const deleteButtons = screen.getAllByTitle('Удалить');
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(deleteSpy).toHaveBeenCalledWith('dl_1_ep1_720');
        });
    });

    it('handles export of an episode', async () => {
        const dummyBlob = new Blob(['sample-data'], { type: 'video/mp4' });
        vi.spyOn(opfsStorage, 'getDownloadedEpisodeBlob').mockResolvedValue(dummyBlob);
        const exportSpy = vi.spyOn(downloadModule, 'triggerBrowserFileDownload').mockImplementation(() => {});

        vi.spyOn(opfsStorage, 'getDownloadedEpisodes').mockResolvedValue([mockEpisodes[0]]);
        vi.spyOn(opfsStorage, 'getStorageEstimate').mockResolvedValue({
            usage: 104857600,
            quota: 10737418240,
            formattedUsage: '100 MB',
            formattedQuota: '10 GB',
            percentUsed: 0.9,
        });

        renderDownloads();

        await waitFor(() => {
            expect(screen.getByText('Attack on Titan')).toBeInTheDocument();
        });

        const exportBtn = screen.getByTitle('Сохранить');
        fireEvent.click(exportBtn);

        await waitFor(() => {
            expect(exportSpy).toHaveBeenCalledWith(dummyBlob, 'AoT_01_720p.mp4');
        });
    });
});
