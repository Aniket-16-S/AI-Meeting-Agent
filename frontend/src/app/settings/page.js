'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

export default function SettingsPage() {
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      if (user.role === 'employee') {
        router.replace('/');
      } else {
        router.replace('/settings/users');
      }
    }
  }, [user, router]);

  return null;
}
