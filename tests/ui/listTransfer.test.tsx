import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AnimeListTransfer from '../../src/components/AnimeListTransfer';
import { renderWithProviders } from './helpers/testUtils';

describe('AnimeListTransfer Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('displays authentication warning when user is not logged in', () => {
        renderWithProviders(<AnimeListTransfer />, {
            userToken: '',
            userId: 0,
        });

        expect(screen.getByText(/Войдите в свой аккаунт Anixart для переноса списков/i)).toBeInTheDocument();
    });

    it('renders export tab with list options when user is logged in', () => {
        localStorage.setItem(
            'user_room_identity',
            JSON.stringify({ id: 10, login: 'TesterOtaku' })
        );

        renderWithProviders(<AnimeListTransfer />, {
            userToken: 'valid_token_123',
            userId: 10,
        });

        // Tabs should be present
        expect(screen.getByRole('tab', { name: /Экспорт списков/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Импорт списков/i })).toBeInTheDocument();

        // Checkboxes should be rendered
        expect(screen.getByLabelText(/Смотрю/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/В планах/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Просмотрено/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Экспортировать списки/i })).toBeInTheDocument();
    });

    it('handles export click, requests paginated lists and triggers download', async () => {
        localStorage.setItem(
            'user_room_identity',
            JSON.stringify({ id: 10, login: 'TesterOtaku' })
        );

        const mockFetch = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/profile/list/all/1/')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            code: 0,
                            total_page_count: 1,
                            content: [
                                {
                                    id: 101,
                                    title_ru: 'Атака титанов',
                                    title_original: 'Shingeki no Kyojin',
                                    profile_list_status: 1,
                                    episodes_released: 25,
                                },
                            ],
                        }),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        code: 0,
                        total_page_count: 1,
                        content: [],
                    }),
            });
        });

        global.fetch = mockFetch;

        const clickSpy = vi.fn();
        HTMLAnchorElement.prototype.click = clickSpy;

        renderWithProviders(<AnimeListTransfer />, {
            userToken: 'valid_token_123',
            userId: 10,
        });

        const exportBtn = screen.getByRole('button', { name: /Экспортировать списки/i });
        fireEvent.click(exportBtn);

        // UI displays fetched entries requiring explicit Shikimori ID resolution
        const idInput = await screen.findByPlaceholderText(/ID или ссылка Shikimori/i);
        expect(idInput).toBeInTheDocument();
        fireEvent.change(idInput, { target: { value: '16498' } });

        // Now that the entry has a verified external ID, execute export
        fireEvent.click(screen.getByRole('button', { name: /Экспортировать списки/i }));

        await waitFor(() => {
            expect(screen.getByText(/Списки успешно сохранены в XML!/i)).toBeInTheDocument();
        });

        expect(clickSpy).toHaveBeenCalled();
    });

    it('switches to import tab and parses uploaded XML file into preview', async () => {
        localStorage.setItem(
            'user_room_identity',
            JSON.stringify({ id: 10, login: 'TesterOtaku' })
        );

        const mockFetch = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/search/releases/0')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            code: 0,
                            releases: [
                                {
                                    id: 101,
                                    title_ru: 'Атака титанов',
                                    title_original: 'Shingeki no Kyojin',
                                    profile_list_status: 0,
                                },
                            ],
                        }),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ code: 0 }),
            });
        });

        global.fetch = mockFetch;

        renderWithProviders(<AnimeListTransfer />, {
            userToken: 'valid_token_123',
            userId: 10,
        });

        // Switch to import tab
        const importTab = screen.getByRole('tab', { name: /Импорт списков/i });
        fireEvent.click(importTab);

        expect(screen.getByText(/Перетащите XML- или JSON-файл сюда или нажмите для выбора/i)).toBeInTheDocument();

        // Create a test file
        const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<myanimelist>
    <anime>
        <series_animedb_id>16498</series_animedb_id>
        <series_title>Shingeki no Kyojin</series_title>
        <series_title_ru>Атака титанов</series_title_ru>
        <my_watched_episodes>25</my_watched_episodes>
        <my_score>10</my_score>
        <my_status>Completed</my_status>
    </anime>
</myanimelist>`;

        const file = new File([xmlContent], 'test_shikimori.xml', { type: 'text/xml' });
        const fileInput = document.getElementById('xml-file-input') as HTMLInputElement;

        fireEvent.change(fileInput, { target: { files: [file] } });

        // Wait for preview to appear
        await waitFor(() => {
            expect(screen.getByText(/Shingeki no Kyojin/i)).toBeInTheDocument();
        });

        expect(screen.getByText(/Подтвердить и импортировать/i)).toBeInTheDocument();
        expect(screen.getByText(/5 \/ 5/i)).toBeInTheDocument(); // Score 10 -> 5/5
    });

    it('rejects malicious XML with DTD entities for security', async () => {
        localStorage.setItem(
            'user_room_identity',
            JSON.stringify({ id: 10, login: 'TesterOtaku' })
        );

        renderWithProviders(<AnimeListTransfer />, {
            userToken: 'valid_token_123',
            userId: 10,
        });

        const importTab = screen.getByRole('tab', { name: /Импорт списков/i });
        fireEvent.click(importTab);

        const maliciousXml = `<?xml version="1.0"?>
<!DOCTYPE test [<!ENTITY xxe SYSTEM "http://malicious.example.com">]>
<myanimelist><anime><series_title>&xxe;</series_title></anime></myanimelist>`;

        const file = new File([maliciousXml], 'malicious.xml', { type: 'text/xml' });
        const fileInput = document.getElementById('xml-file-input') as HTMLInputElement;

        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => {
            expect(screen.getByText(/Файл отклонён из соображений безопасности/i)).toBeInTheDocument();
        });
    });

    it('confirms and executes import sequentially, calling API for each approved release', async () => {
        localStorage.setItem(
            'user_room_identity',
            JSON.stringify({ id: 10, login: 'TesterOtaku' })
        );

        const apiCalls: string[] = [];
        const mockFetch = vi.fn().mockImplementation((url: string) => {
            apiCalls.push(url);
            if (url.includes('/release/101')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            code: 0,
                            release: {
                                id: 101,
                                title_ru: 'Атака титанов',
                                title_original: 'Shingeki no Kyojin',
                                profile_list_status: 0,
                                your_vote: 0,
                            },
                        }),
                });
            }
            if (url.includes('/search/releases/0')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            code: 0,
                            releases: [
                                {
                                    id: 101,
                                    title_ru: 'Атака титанов',
                                    title_original: 'Shingeki no Kyojin',
                                    profile_list_status: 0,
                                    your_vote: 0,
                                },
                            ],
                        }),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ code: 0 }),
            });
        });

        global.fetch = mockFetch;

        renderWithProviders(<AnimeListTransfer />, {
            userToken: 'valid_token_123',
            userId: 10,
        });

        const importTab = screen.getByRole('tab', { name: /Импорт списков/i });
        fireEvent.click(importTab);

        const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<myanimelist>
    <anime>
        <series_animedb_id>16498</series_animedb_id>
        <series_title>Shingeki no Kyojin</series_title>
        <my_watched_episodes>25</my_watched_episodes>
        <my_score>10</my_score>
        <my_status>Completed</my_status>
        <anixart_id>101</anixart_id>
    </anime>
</myanimelist>`;

        const file = new File([xmlContent], 'import.xml', { type: 'text/xml' });
        const fileInput = document.getElementById('xml-file-input') as HTMLInputElement;
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Подтвердить и импортировать/i })).toBeInTheDocument();
        });

        const confirmBtn = screen.getByRole('button', { name: /Подтвердить и импортировать/i });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(screen.getByText(/Все выбранные записи успешно импортированы!/i)).toBeInTheDocument();
        });

        expect(apiCalls.some(url => url.includes('/profile/list/add/3/101'))).toBe(true);
        expect(apiCalls.some(url => url.includes('/release/vote/add/101/5'))).toBe(true);
    });

    it('rejects blind title matching and requires manual resolution for generic MAL XML', async () => {
        localStorage.setItem(
            'user_room_identity',
            JSON.stringify({ id: 10, login: 'TesterOtaku' })
        );

        const mockFetch = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/search/releases/0')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            code: 0,
                            releases: [
                                {
                                    id: 101,
                                    title_ru: 'Атака титанов',
                                    title_original: 'Shingeki no Kyojin',
                                    profile_list_status: 0,
                                    your_vote: 0,
                                },
                            ],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0 }) });
        });

        global.fetch = mockFetch;

        renderWithProviders(<AnimeListTransfer />, {
            userToken: 'valid_token_123',
            userId: 10,
        });

        const importTab = screen.getByRole('tab', { name: /Импорт списков/i });
        fireEvent.click(importTab);

        const genericXml = `<?xml version="1.0" encoding="UTF-8"?>
<myanimelist>
    <anime>
        <series_animedb_id>16498</series_animedb_id>
        <series_title>Shingeki no Kyojin</series_title>
        <my_watched_episodes>25</my_watched_episodes>
        <my_score>10</my_score>
        <my_status>Completed</my_status>
    </anime>
</myanimelist>`;

        const file = new File([genericXml], 'generic.xml', { type: 'text/xml' });
        const fileInput = document.getElementById('xml-file-input') as HTMLInputElement;
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => {
            expect(screen.getByText(/Shingeki no Kyojin/i)).toBeInTheDocument();
        });

        expect(screen.getByText(/Не найдено/i)).toBeInTheDocument();
        const confirmBtn = screen.getByRole('button', { name: /Подтвердить и импортировать \(0\)/i });
        expect(confirmBtn).toBeDisabled();
    });

    it('supports native Shikimori JSON import and preserves data', async () => {
        localStorage.setItem(
            'user_room_identity',
            JSON.stringify({ id: 10, login: 'TesterOtaku' })
        );

        const mockFetch = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/search/releases/0')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            code: 0,
                            releases: [
                                {
                                    id: 202,
                                    title_ru: 'Человек-бензопила',
                                    title_original: 'Chainsaw Man',
                                    profile_list_status: 0,
                                },
                            ],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0 }) });
        });

        global.fetch = mockFetch;

        renderWithProviders(<AnimeListTransfer />, {
            userToken: 'valid_token_123',
            userId: 10,
        });

        const importTab = screen.getByRole('tab', { name: /Импорт списков/i });
        fireEvent.click(importTab);

        const jsonContent = JSON.stringify([
            {
                target_id: 44511,
                target_type: 'Anime',
                target_title: 'Chainsaw Man',
                target_title_ru: 'Человек-бензопила',
                status: 'watching',
                score: 8,
                episodes: 12,
            },
        ]);

        const file = new File([jsonContent], 'shikimori.json', { type: 'application/json' });
        const fileInput = document.getElementById('xml-file-input') as HTMLInputElement;
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => {
            expect(screen.getByText(/Chainsaw Man/i)).toBeInTheDocument();
        });

        expect(screen.getByText(/4 \/ 5/i)).toBeInTheDocument(); // Score 8 -> 4/5
        expect(screen.getByRole('button', { name: /Подтвердить и импортировать/i })).toBeInTheDocument();
    });

    it('exports to native Shikimori JSON with verified external target_id', async () => {
        localStorage.setItem(
            'user_room_identity',
            JSON.stringify({ id: 10, login: 'TesterOtaku' })
        );

        const mockFetch = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/profile/list/all/1/')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            code: 0,
                            total_page_count: 1,
                            content: [
                                {
                                    id: 101,
                                    title_ru: 'Атака титанов',
                                    title_original: 'Shingeki no Kyojin',
                                    profile_list_status: 1,
                                    episodes_released: 25,
                                    your_vote: 5,
                                },
                            ],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 0, total_page_count: 1, content: [] }) });
        });

        global.fetch = mockFetch;

        let downloadedContent = '';
        HTMLAnchorElement.prototype.click = vi.fn();

        // Mock URL.createObjectURL to capture blob content
        global.URL.createObjectURL = vi.fn((blob: Blob) => {
            void blob.text().then(text => { downloadedContent = text; });
            return 'blob:mock-url';
        });

        renderWithProviders(<AnimeListTransfer />, {
            userToken: 'valid_token_123',
            userId: 10,
        });

        // Select JSON format
        const jsonRadio = screen.getByLabelText(/JSON \(Shikimori\)/i);
        fireEvent.click(jsonRadio);

        // Fetch entries
        fireEvent.click(screen.getByRole('button', { name: /Экспортировать списки/i }));

        // Resolve external Shikimori ID
        const idInput = await screen.findByPlaceholderText(/ID или ссылка Shikimori/i);
        fireEvent.change(idInput, { target: { value: '16498' } });

        // Execute export
        fireEvent.click(screen.getByRole('button', { name: /Экспортировать списки/i }));

        await waitFor(() => {
            expect(screen.getByText(/Списки успешно сохранены в JSON!/i)).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(downloadedContent).toContain('"target_id": 16498');
            expect(downloadedContent).toContain('"anixart_id": 101');
            expect(downloadedContent).toContain('"status": "watching"');
        });
    });
});

