import React, { useContext, useEffect, useState } from 'react';
import { getCurrentUser, updateUserData, loginUser, signupUser, logoutUser } from "../scripts/api.js";

const AuthContext = React.createContext();

export function useAuth() {
    return useContext(AuthContext);
}

function AuthProvider({ children }) {
    const [currentUser, setCurrentUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    async function fetchUser() {
        try {
            const user = await getCurrentUser();
            setCurrentUser(user);
        } catch {
            setCurrentUser(null);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        fetchUser();
    }, []);

    async function login(email, password) {
        const user = await loginUser(email, password);
        setCurrentUser(user);
        return user;
    }

    async function signup(email, password, name, timezone) {
        const user = await signupUser(email, password, name, timezone);
        setCurrentUser(user);
        return user;
    }

    async function logout() {
        await logoutUser();
        setCurrentUser(null);
    }

    async function updateUser(data) {
        try {
            const updated = await updateUserData(data);
            setCurrentUser(updated);
            return updated;
        } catch (err) {
            return err.message;
        }
    }

    const value = {
        currentUser,
        isLoading,
        login,
        signup,
        logout,
        updateUser,
        refetchUser: fetchUser,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export default AuthProvider;
