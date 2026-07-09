<script setup lang="ts">
/**
 * Users & Roles admin page — two tabs (mirrors LogsView's Logs/Executions
 * split): manage staff accounts and the roles that gate what they see. Each
 * tab's table + dialogs live in their own component (UsersTable/RolesTable)
 * so this shell stays a thin wrapper.
 */
import { ref } from 'vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import UsersTable from '@/components/admin/UsersTable.vue'
import RolesTable from '@/components/admin/RolesTable.vue'

const tab = ref('users')
</script>

<template>
  <div class="flex flex-col gap-4 p-6">
    <Tabs v-model="tab">
      <TabsList>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="roles">Roles</TabsTrigger>
      </TabsList>

      <TabsContent value="users" class="space-y-4">
        <UsersTable />
      </TabsContent>

      <TabsContent value="roles" class="space-y-4">
        <RolesTable />
      </TabsContent>
    </Tabs>
  </div>
</template>
