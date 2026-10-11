export const mockLoginResponses = {
    successWithProfile: {
        code: 0,
        profileToken: {
            token: 'valid-test-token-12345',
        },
        profile: {
            id: 1042,
            login: 'naruto_fan',
            avatar: 'https://s.anixmirai.com/avatars/1042.jpg',
        },
    },
    successWithoutProfile: {
        code: 0,
        profileToken: {
            token: 'token-without-inline-profile-67890',
        },
    },
    invalidCredentials: {
        code: 2,
        message: 'Неверный логин или пароль',
    },
    missingToken: {
        code: 0,
    },
};

export const mockProfileSearchResponse = {
    code: 0,
    content: [
        {
            id: 9999,
            login: 'other_user',
            avatar: null,
        },
        {
            id: 5555,
            login: 'naruto_fan',
            avatar: 'https://s.anixmirai.com/avatars/5555.jpg',
        },
    ],
};
