'use client';

import OpenChatApp from '@/components/chat-app/OpenChatApp';
import { useRouter } from 'next/navigation';

export default function ChatPage() {
  const router = useRouter();

  return (
    <OpenChatApp
      onSwitchToCode={() => router.push('/')}
      onOpenProject={(projectId) => router.push(`/?projectId=${encodeURIComponent(projectId)}`)}
    />
  );
}

