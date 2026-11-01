package handler_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"testing-app/handler"
	"testing-app/testutil"

	"github.com/stretchr/testify/require"
)

type stepBlock struct {
	ID      int32  `json:"id"`
	Order   int16  `json:"order_num"`
	Content string `json:"content"`
}

func createStepLesson(t *testing.T, h http.Handler, token, title string) string {
	t.Helper()
	w := testutil.Request(t, h, "POST", "/api/v1/lessons", fmt.Sprintf(`{"title":%q,"visibility":"private"}`, title), token)
	require.Equal(t, 201, w.Code, w.Body.String())
	var lesson struct {
		ID int32 `json:"id"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &lesson))
	return fmt.Sprintf("/api/v1/lessons/%d/blocks", lesson.ID)
}

func createStepBlock(t *testing.T, h http.Handler, token, path, content string) stepBlock {
	t.Helper()
	w := testutil.Request(t, h, "POST", path, fmt.Sprintf(`{"type":"text","content":%q}`, content), token)
	require.Equal(t, 201, w.Code, w.Body.String())
	var block stepBlock
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &block))
	return block
}

func readStepBlocks(t *testing.T, h http.Handler, token, path string) []stepBlock {
	t.Helper()
	w := testutil.Request(t, h, "GET", path, "", token)
	require.Equal(t, 200, w.Code, w.Body.String())
	var blocks []stepBlock
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &blocks))
	return blocks
}

func TestLessonStepReorderIsScopedAndComplete(t *testing.T) {
	h, mock := newRouter(t)
	owner := registerTokens(t, h, mock, "step-owner", 1)["access_token"]
	other := registerTokens(t, h, mock, "step-other", 1)["access_token"]
	path := createStepLesson(t, h, owner, "First lesson")
	secondPath := createStepLesson(t, h, owner, "Second lesson")
	a := createStepBlock(t, h, owner, path, "first")
	b := createStepBlock(t, h, owner, path, "second")
	c := createStepBlock(t, h, owner, secondPath, "unrelated")
	baseline := readStepBlocks(t, h, owner, path)
	for _, body := range []string{
		`{"order":[]}`,
		fmt.Sprintf(`{"order":[{"id":%d,"order_num":0}]}`, a.ID),
		fmt.Sprintf(`{"order":[{"id":%d,"order_num":0},{"id":%d,"order_num":1}]}`, a.ID, a.ID),
		fmt.Sprintf(`{"order":[{"id":%d,"order_num":0},{"id":%d,"order_num":0}]}`, a.ID, b.ID),
		fmt.Sprintf(`{"order":[{"id":%d,"order_num":-1},{"id":%d,"order_num":1}]}`, a.ID, b.ID),
		fmt.Sprintf(`{"order":[{"id":%d,"order_num":0},{"id":%d,"order_num":2}]}`, a.ID, b.ID),
		fmt.Sprintf(`{"order":[{"id":%d,"order_num":0},{"id":%d,"order_num":1}]}`, a.ID, c.ID),
		fmt.Sprintf(`{"order":[{"id":%d,"order_num":0},{"id":2147483647,"order_num":1}]}`, a.ID),
	} {
		w := testutil.Request(t, h, "POST", path+"/reorder", body, owner)
		require.Equal(t, 400, w.Code, w.Body.String())
		require.Equal(t, baseline, readStepBlocks(t, h, owner, path))
		require.Equal(t, []stepBlock{c}, readStepBlocks(t, h, owner, secondPath))
	}
	body := fmt.Sprintf(`{"order":[{"id":%d,"order_num":0},{"id":%d,"order_num":1}]}`, b.ID, a.ID)
	require.Equal(t, 404, testutil.Request(t, h, "POST", path+"/reorder", body, other).Code)
	require.Equal(t, baseline, readStepBlocks(t, h, owner, path))
	require.Equal(t, 204, testutil.Request(t, h, "POST", path+"/reorder", body, owner).Code)
	ordered := readStepBlocks(t, h, owner, path)
	require.Equal(t, b.ID, ordered[0].ID)
	require.Equal(t, int16(0), ordered[0].Order)
	require.Equal(t, a.ID, ordered[1].ID)
	// Repeating the full order is idempotent.
	require.Equal(t, 204, testutil.Request(t, h, "POST", path+"/reorder", body, owner).Code)
	emptyPath := createStepLesson(t, h, owner, "Empty lesson")
	require.Equal(t, 204, testutil.Request(t, h, "POST", emptyPath+"/reorder", `{"order":[]}`, owner).Code)
	require.Equal(t, 400, testutil.Request(t, h, "POST", emptyPath, `{"type":"unsupported"}`, owner).Code)
	require.Empty(t, readStepBlocks(t, h, owner, emptyPath))
}

func TestLessonStepReorderRollsBackFailedWrite(t *testing.T) {
	pool, cfg := testutil.Setup(t)
	mock := &testutil.MockSender{}
	h := handler.NewRouter(pool, cfg, mock)
	owner := registerTokens(t, h, mock, "atomic-step-owner", 1)["access_token"]
	path := createStepLesson(t, h, owner, "Atomic order")
	a := createStepBlock(t, h, owner, path, "first")
	b := createStepBlock(t, h, owner, path, "reject-order")
	before := readStepBlocks(t, h, owner, path)
	// A test-only constraint forces the second write to fail after the first update.
	_, err := pool.Exec(context.Background(), `ALTER TABLE lesson_blocks ADD CONSTRAINT lesson_step_test_order_check CHECK (NOT (content='reject-order' AND order_num=0))`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := pool.Exec(context.Background(), `ALTER TABLE lesson_blocks DROP CONSTRAINT IF EXISTS lesson_step_test_order_check`)
		if err != nil {
			t.Errorf("remove test constraint: %v", err)
		}
	})
	body := fmt.Sprintf(`{"order":[{"id":%d,"order_num":1},{"id":%d,"order_num":0}]}`, a.ID, b.ID)
	require.Equal(t, 500, testutil.Request(t, h, "POST", path+"/reorder", body, owner).Code)
	require.Equal(t, before, readStepBlocks(t, h, owner, path))
}

func TestLessonStepConcurrentAppendHasUniqueOrder(t *testing.T) {
	h, mock := newRouter(t)
	owner := registerTokens(t, h, mock, "parallel-step-owner", 1)["access_token"]
	path := createStepLesson(t, h, owner, "Parallel steps")
	const count = 6
	responses := make(chan int, count)
	var wg sync.WaitGroup
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			responses <- testutil.Request(t, h, "POST", path, `{"type":"note","content":"Parallel note"}`, owner).Code
		}()
	}
	wg.Wait()
	close(responses)
	for status := range responses {
		require.Equal(t, 201, status)
	}
	blocks := readStepBlocks(t, h, owner, path)
	require.Len(t, blocks, count)
	for index, block := range blocks {
		require.Equal(t, int16(index), block.Order)
	}
}
